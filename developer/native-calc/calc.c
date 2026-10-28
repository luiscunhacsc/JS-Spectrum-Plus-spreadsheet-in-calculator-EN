/* Spectrum Calc: all UI, keyboard handling and formula evaluation run on Z80.
 * z88dk classic +zx, origin 24000, no emulator services needed for computation.
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <ctype.h>
#include <input.h>
#include "calc.h"

char sheet_cells[COUNT][TEXT];
/* A direct-mapped cache leaves RAM for native drag/fill without reducing the
 * grid or floating-point precision. State 3 means a completed text cell. */
double sheet_values[64];
unsigned int sheet_cache_ids[64];
unsigned char sheet_states[COUNT], sheet_errors[COUNT];
unsigned char sheet_initialized;
unsigned char sheet_row, sheet_col, sheet_top, sheet_left, sheet_ready;
char edit_buffer[TEXT], message[64], output[64];
unsigned char editing, edit_len, help_active;

/* Original 3x5 glyphs, ASCII 32..95, in a 4x8 character cell. */
const unsigned char glyphs[64][5] = {
 {0,0,0,0,0},{2,2,2,0,2},{5,5,0,0,0},{5,7,5,7,5},
 {3,6,3,6,2},{5,1,2,4,5},{2,5,2,5,3},{2,2,0,0,0},
 {1,2,2,2,1},{4,2,2,2,4},{0,5,2,5,0},{0,2,7,2,0},
 {0,0,0,2,4},{0,0,7,0,0},{0,0,0,0,2},{1,1,2,4,4},
 {7,5,5,5,7},{2,6,2,2,7},{6,1,7,4,7},{6,1,3,1,6},
 {5,5,7,1,1},{7,4,6,1,6},{3,4,7,5,7},{7,1,2,2,2},
 {7,5,7,5,7},{7,5,7,1,6},{0,2,0,2,0},{0,2,0,2,4},
 {1,2,4,2,1},{0,7,0,7,0},{4,2,1,2,4},{6,1,2,0,2},
 {7,5,7,4,3},{2,5,7,5,5},{6,5,6,5,6},{3,4,4,4,3},
 {6,5,5,5,6},{7,4,6,4,7},{7,4,6,4,4},{3,4,5,5,3},
 {5,5,7,5,5},{7,2,2,2,7},{1,1,1,5,2},{5,5,6,5,5},
 {4,4,4,4,7},{5,7,7,5,5},{5,7,7,7,5},{2,5,5,5,2},
 {6,5,6,4,4},{2,5,5,7,3},{6,5,6,5,5},{3,4,2,1,6},
 {7,2,2,2,2},{5,5,5,5,7},{5,5,5,5,2},{5,5,7,7,5},
 {5,5,2,5,5},{5,5,2,2,2},{7,1,2,4,7},{3,2,2,2,3},
 {4,4,2,1,1},{6,2,2,2,6},{2,5,0,0,0},{0,0,0,0,7}
};

extern void character(unsigned char x, unsigned char y, char ch, unsigned char attr);
extern void cell_edge(unsigned char x, unsigned char y);
void text_at(unsigned char x, unsigned char y, const char *str, unsigned char width, unsigned char attr) {
    while (width--) { character(x++, y, *str ? *str++ : ' ', attr); }
}
unsigned int cell_id(unsigned char row, unsigned char col) { return (unsigned int)row * COLS + col; }

/* Error codes: syntax, reference, zero division, cycle, text operand, overflow. */
const char *error_name(unsigned char code) {
    switch (code) {
        case 1: return "#FORMULA"; case 2: return "#REF!"; case 3: return "#DIV/0!";
        case 4: return "#CYCLE!"; case 5: return "#VALUE!"; case 6: return "#NUM!";
        case 7: return "#NAME?";
    }
    return "";
}
typedef struct { char *p; unsigned char error, depth; } Parser;
unsigned char parser_depth;
double expression(Parser *p);
double calculate(unsigned int id);
void skip_space(Parser *p) { while (*p->p == ' ') p->p++; }
int reference(Parser *p) {
    int col, row;
    skip_space(p);
    if (*p->p == '$') p->p++;
    if (!isalpha(*p->p)) { p->error = 2; return -1; }
    col = toupper(*p->p++) - 'A';
    if (*p->p == '$') p->p++;
    if (!isdigit(*p->p)) { p->error = 2; return -1; }
    row = 0;
    while (isdigit(*p->p)) { row = row * 10 + *p->p++ - '0'; if (row > ROWS) { p->error = 2; return -1; } }
    if (col < 0 || col >= COLS || row < 1 || row > ROWS) { p->error = 2; return -1; }
    return (row - 1) * COLS + col;
}
double read_number(Parser *p) {
    double value, divisor;
    unsigned char digits;
    value = 0; digits = 0;
    while (isdigit(*p->p)) { value = value * 10 + *p->p++ - '0'; digits++; }
    if (*p->p == '.' || *p->p == ',') {
        p->p++; divisor = 10;
        while (isdigit(*p->p)) { value += (*p->p++ - '0') / divisor; divisor *= 10; digits++; }
    }
    if (!digits) p->error = 1;
    if (value > 999999999.0) p->error = 6;
    return value;
}
double operand(Parser *p, int id) {
    double value;
    if (id < 0) return 0;
    value = calculate(id);
    if (sheet_errors[id]) p->error = sheet_errors[id];
    return value;
}
double primary(Parser *p) {
    double value,item;
    int first, last, row, col, r1, r2, c1, c2, tmp;
    char name[8]; unsigned char n,fn; unsigned int count;
    skip_space(p);
    p->depth++; parser_depth++;
    if (p->depth>20 || parser_depth>24) { p->error=1; p->depth--; parser_depth--; return 0; }
    value = 0;
    if (!strncmp(p->p,"#REF!",5)) { p->error=2; p->p+=5; }
    else if (*p->p == '+' || *p->p == '-') {
        n = *p->p++; value = primary(p); if (n == '-') value = -value;
    } else if (*p->p == '(') {
        p->p++; value = expression(p); skip_space(p);
        if (*p->p == ')') p->p++; else p->error = 1;
    } else if (isalpha(*p->p) && isalpha(p->p[1])) {
        n = 0;
        while (isalpha(*p->p)) { if (n < 7) name[n++] = toupper(*p->p); else p->error=7; p->p++; }
        name[n] = 0; skip_space(p);
        fn=0;
        if (!strcmp(name,"SUM")) fn=1;
        if (!strcmp(name,"AVERAGE")) fn=2;
        if (!strcmp(name,"MIN")) fn=3;
        if (!strcmp(name,"MAX")) fn=4;
        if (!strcmp(name,"COUNT")) fn=5;
        if (!fn) p->error=7;
        if (*p->p != '(') p->error=1;
        if (p->error) { p->depth--; parser_depth--; return 0; }
        else {
            p->p++;
            /* English aggregate functions accept rectangular ranges. */
            first = reference(p); skip_space(p);
            if (*p->p != ':') p->error = 1;
            else {
                p->p++; last = reference(p); skip_space(p);
                if (*p->p != ')') p->error = 1;
                else p->p++;
                if (!p->error && first >= 0 && last >= 0) {
                    r1 = first / COLS; r2 = last / COLS; c1 = first % COLS; c2 = last % COLS;
                    if (r1 > r2) { tmp = r1; r1 = r2; r2 = tmp; }
                    if (c1 > c2) { tmp = c1; c1 = c2; c2 = tmp; }
                    count=0;
                    for (row = r1; row <= r2; row++) for (col = c1; col <= c2; col++) {
                        first=row*COLS+col; item=operand(p,first);
                        if (*sheet_cells[first] && sheet_states[first]!=3) {
                            if (fn==3) { if (!count || item<value) value=item; }
                            else if (fn==4) { if (!count || item>value) value=item; }
                            else value+=item;
                            count++;
                        }
                    }
                    if (fn==2) { if (count) value/=count; else p->error=3; }
                    if (fn==5) value=count;
                }
            }
        }
    } else if (isalpha(*p->p) || *p->p == '$') {
        first = reference(p); value = operand(p, first);
        if (first >= 0 && sheet_states[first]==3) p->error = 5;
    } else value = read_number(p);
    p->depth--; parser_depth--; return value;
}
double product(Parser *p) {
    double value, right; char op;
    value = primary(p); skip_space(p);
    while (!p->error && (*p->p == '*' || *p->p == '/')) {
        op = *p->p++; right = primary(p);
        if (op == '/' && right == 0) { p->error = 3; return 0; }
        value = op == '*' ? value * right : value / right; skip_space(p);
        if (value > 999999999.0 || value < -999999999.0) { p->error = 6; return 0; }
    }
    return value;
}
double expression(Parser *p) {
    double value, right; char op;
    value = product(p); skip_space(p);
    while (!p->error && (*p->p == '+' || *p->p == '-')) {
        op = *p->p++; right = product(p);
        value = op == '+' ? value + right : value - right; skip_space(p);
    }
    return value;
}
unsigned char evaluation_depth;
double calculate(unsigned int id) {
    Parser parser; double value; char *raw;
    unsigned char slot,is_text;
    slot=id&63; is_text=0;
    if (sheet_states[id]>=2 && sheet_cache_ids[slot]==id) return sheet_values[slot];
    if (sheet_states[id] == 1) { sheet_errors[id] = 4; return 0; }
    if (evaluation_depth >= 24) { sheet_errors[id] = 4; return 0; }
    sheet_states[id] = 1; evaluation_depth++;
    raw = sheet_cells[id]; parser.p = raw; parser.error = 0; parser.depth = 0;
    skip_space(&parser); value = 0;
    if (!*parser.p && *raw) is_text=1;
    if (*parser.p == '=') { parser.p++; value = expression(&parser); skip_space(&parser); if (*parser.p && !parser.error) parser.error = 1; }
    else if (*parser.p) {
        if (*parser.p == '-') { parser.p++; value = -read_number(&parser); }
        else if (*parser.p == '+') { parser.p++; value = read_number(&parser); }
        else value = read_number(&parser);
        skip_space(&parser);
        if (parser.error || *parser.p) { is_text=1; parser.error = 0; value = 0; }
    }
    if (value > 999999999.0 || value < -999999999.0) parser.error = 6;
    sheet_errors[id] = parser.error; sheet_values[slot] = value; sheet_cache_ids[slot]=id;
    sheet_states[id] = is_text?3:2; evaluation_depth--; return value;
}
void recalculate(void) {
    unsigned int id;
    memset(sheet_states,0,COUNT); memset(sheet_errors,0,COUNT); memset(sheet_cache_ids,255,sizeof(sheet_cache_ids));
    evaluation_depth = parser_depth = 0;
    for (id = 0; id < COUNT; id++) if (*sheet_cells[id]) calculate(id);
}
void cell_string(unsigned int id, char *dest) {
    char *end;
    double value;
    if (!*sheet_cells[id]) { *dest = 0; return; }
    value=calculate(id);
    if (sheet_errors[id]) { strcpy(dest,error_name(sheet_errors[id])); return; }
    if (sheet_states[id]==3) { strcpy(dest,sheet_cells[id]); return; }
    sprintf(dest,"%.2f",value);
    end = dest + strlen(dest) - 1;
    while (*end == '0') *end-- = 0;
    if (*end == '.') *end = 0;
}
unsigned char cell_attr(unsigned char row, unsigned char col) {
    unsigned int id;
    unsigned char attr;
    id=cell_id(row,col); attr=56;
    if (*sheet_cells[id]=='=') attr=57;
    if (in_fill_range(row,col)) attr=96;
    if (row==sheet_row && col==sheet_col) attr=104;
    if (sheet_errors[id]) attr=(attr==104)?106:58;
    return attr;
}
void paint_cell(unsigned char row, unsigned char col) {
    unsigned int id; unsigned char x,y,attr,len;
    if (row < sheet_top || row >= sheet_top + VIEW || col < sheet_left || col >= sheet_left + 4) return;
    id = cell_id(row,col); x = 4 + (col-sheet_left)*14; y = 5 + row-sheet_top;
    attr = cell_attr(row,col);
    cell_string(id,output); len = strlen(output);
    text_at(x,y,"",14,attr);
    if (len > 11 && sheet_states[id]!=3) text_at(x+1,y,"###########",11,attr);
    else text_at(x + (sheet_states[id]!=3 && len < 11 ? 12-len : 1),y,output,len > 11 ? 11 : len,attr);
    cell_edge(x,y);
    if (row==sheet_row && col==sheet_col && *sheet_cells[id]) {
        unsigned char *handle;
        handle=(unsigned char *)(16384+((y&24)<<8)+((y&7)<<5)+((x+13)>>1)+1536);
        *handle|=3; *(handle+256)|=3;
    }
}
void refresh_attrs(void) {
    unsigned char row,col,attr;
    for (row=sheet_top;row<sheet_top+VIEW;row++) for (col=sheet_left;col<sheet_left+4;col++) {
        attr=cell_attr(row,col);
        memset((void *)(22528+(5+row-sheet_top)*32+2+(col-sheet_left)*7),attr,7);
    }
}
void edit_line(void) {
    text_at(10,1,edit_buffer,54,112); character(10+edit_len,1,'_',112);
}
void bars(void) {
    unsigned int id;
    id = cell_id(sheet_row,sheet_col);
    text_at(0,3,editing?"[ SAVE ] [ CANCEL ]":fill_mode?"[ APPLY ] [ CANCEL ]":"[ EDIT ]  [ CLEAR ]  [ COPY ]    [ HELP ]     [ EXIT ]",64,79);
    sprintf(output," %c%d",'A'+sheet_col,sheet_row+1); text_at(0,1,output,6,104);
    text_at(6,1," FX ",4,79);
    text_at(10,1,*sheet_cells[id]?sheet_cells[id]:"NUMBER, TEXT OR =FORMULA",54,56);
    text_at(0,2," VALUE ",7,7); cell_string(id,output); text_at(7,2,output,33,71);
    text_at(40,2,editing?"EDITING / MAX. 31":sheet_errors[id]?"ERROR":!*sheet_cells[id]?"EMPTY":*sheet_cells[id]=='='?"FORMULA":sheet_states[id]==3?"TEXT":"NUMBER",24,editing?70:sheet_errors[id]?66:7);
    text_at(0,22,*message?message:" CLICK OR TYPE. E.G. 12.50 OR =A1*B1",64,7);
    text_at(0,23,editing?" ENTER SAVE / ESC OR CAPS+SPACE CANCEL":fill_mode?" CLICK OR ARROWS / ENTER COPY / ESC CANCEL":" ENTER EDIT / DEL CLEAR / F4/SS+E HELP / F5/SS+F COPY",64,editing?112:71);
    if (editing) edit_line();
}
void headers(void) {
    unsigned char row,col;
    for (col=0;col<4;col++) {
        sprintf(output,"      %c",'A'+sheet_left+col);
        text_at(4+col*14,4,output,14,sheet_left+col==sheet_col?104:79);
    }
    for (row=0;row<VIEW;row++) {
        sprintf(output,"%2d",sheet_top+row+1);
        text_at(1,5+row,output,3,sheet_top+row==sheet_row?104:79);
    }
}
void refresh_cells(void) {
    unsigned char row,col;
    for (row = sheet_top; row < sheet_top + VIEW; row++) for (col = sheet_left; col < sheet_left+4; col++) {
        if (*sheet_cells[cell_id(row,col)]) paint_cell(row,col);
    }
    paint_cell(sheet_row,sheet_col);
}
void draw(void) {
    unsigned char row,col;
    memset((void *)16384,0,6144); memset((void *)22528,71,768);
    text_at(0,0," SPECTRUM CALC                     SPREADSHEET / 128K",64,79);
    text_at(0,4," #",4,79); text_at(60,4,"",4,79);
    headers();
    for (row = 0; row < VIEW; row++) {
        for (col = 0; col < 4; col++) paint_cell(sheet_top+row,sheet_left+col);
    }
    sprintf(output,"[<] %c-%c [>]",'A'+sheet_left,'D'+sheet_left); text_at(0,21,output,12,79);
    sprintf(output,"%02d-%02d/64",sheet_top+1,sheet_top+VIEW); text_at(16,21,output,12,7);
    text_at(32,21,"[^] UP",14,79); text_at(48,21,"[V] DOWN",16,79);
    bars();
}
void help(void) {
    help_active=1;
    memset((void *)16384,0,6144); memset((void *)22528,71,768);
    text_at(0,0," SPECTRUM CALC / AVAILABLE FORMULAS",64,79);
    text_at(0,2,"FUNCTION  MEANING    EXAMPLE",64,71);
    text_at(0,4,"SUM       TOTAL      =SUM(C2:C10)",64,69);
    text_at(0,6,"AVERAGE   MEAN       =AVERAGE(C2:C10)",64,69);
    text_at(0,8,"MIN       MINIMUM    =MIN(C2:C10)",64,69);
    text_at(0,10,"MAX       MAXIMUM    =MAX(C2:C10)",64,69);
    text_at(0,12,"COUNT     NUMBERS    =COUNT(C2:C10)",64,69);
    text_at(0,14,"MATH: + - * /  E.G.: =(A2+B2)*2",64,71);
    text_at(0,16,"REFS: A2 / $A$2 ABSOLUTE / $A2 OR A$2 MIXED",64,71);
    text_at(0,18,"COPY: DRAG A CORNER OR USE F5/SS+F AND ARROWS.",64,71);
    text_at(0,20,"MAX 31 CHARACTERS. DECIMALS: . OR ,",64,71);
    text_at(0,23,"[ BACK TO SHEET ]  CLICK, ENTER OR ESC",64,104);
}
void move_cell(int dr,int dc) {
    unsigned char oldrow,oldcol,newtop,newleft;
    int row,col;
    oldrow = sheet_row; oldcol = sheet_col;
    row=sheet_row+dr; col=sheet_col+dc;
    if (row<0) row=0; if (row>=ROWS) row=ROWS-1;
    if (col<0) col=0; if (col>=COLS) col=COLS-1;
    sheet_row=row; sheet_col=col;
    if (!fill_mode) *message=0;
    if (fill_mode==1) { fill_row=sheet_row; fill_col=sheet_col; }
    newtop = sheet_top;
    if (sheet_row < newtop) newtop = (sheet_row/VIEW)*VIEW;
    if (sheet_row >= newtop+VIEW) newtop = (sheet_row/VIEW)*VIEW;
    newleft = (sheet_col/4)*4;
    if (newtop != sheet_top || newleft != sheet_left) { sheet_top = newtop; sheet_left = newleft; draw(); }
    else { paint_cell(oldrow,oldcol); paint_cell(sheet_row,sheet_col); headers(); if (fill_mode) refresh_attrs(); bars(); }
}
void begin_edit(unsigned char clear) {
    if (clear) *edit_buffer = 0; else strcpy(edit_buffer,sheet_cells[cell_id(sheet_row,sheet_col)]);
    edit_len = strlen(edit_buffer); editing = 1; bars();
}
void commit_edit(void) {
    strcpy(sheet_cells[cell_id(sheet_row,sheet_col)],edit_buffer);
    editing=0; recalculate(); refresh_cells(); bars();
}
void clear_cell(void) {
    *sheet_cells[cell_id(sheet_row,sheet_col)]=0;
    strcpy(message,"CELL CLEARED.");
    recalculate(); refresh_cells(); bars();
}
unsigned int read_key(void) {
    if (!(inp(0xfefe) & 1) && !(inp(0x7ffe) & 1)) return 6;
    return in_Inkey();
}
int main(void) {
    unsigned int key,previous;
    /* The real keyboard is polled; the application's computation needs no ROM. */
#asm
    di
#endasm
    outp(254,0);
    if (!sheet_initialized) { memset(sheet_cells,0,sizeof(sheet_cells)); sheet_initialized = 1; }
    sheet_row = sheet_col = sheet_top = sheet_left = editing = 0;
    *message=0;
    in_MouseKempInit();
    recalculate(); draw(); sheet_ready = 1; previous = 0;
    /* Ignore the Enter that launched Calculator. */
    in_WaitForNoKey();
    for (;;) {
        key = poll_mouse();
        if (!key) { key=read_key(); if (key!=read_key()) continue; }
        if (!key) { previous = 0; continue; }
        if (key == previous) continue;
        previous = key;
        if (help_active) {
            if (key==13 || key==6) { help_active=0; draw(); }
        } else if (editing) {
            if (key == 13) {
                commit_edit(); move_cell(1,0);
            } else if (key == 12) {
                if (edit_len) edit_buffer[--edit_len] = 0; edit_line();
            } else if (key == 6) { editing = 0; bars(); }
            else if (key >= 32 && key < 127 && edit_len < TEXT-1) {
                edit_buffer[edit_len++] = key; edit_buffer[edit_len] = 0; edit_line();
            }
        } else if (fill_mode) {
            if (key==8) move_cell(0,-1);
            else if (key==9) move_cell(0,1);
            else if (key==10) move_cell(1,0);
            else if (key==11) move_cell(-1,0);
            else if (key==13) apply_fill();
            else if (key==6) cancel_fill();
            else if (key==133) help();
        } else {
            if (key == 8) move_cell(0,-1);
            else if (key == 9) move_cell(0,1);
            else if (key == 10) move_cell(1,0);
            else if (key == 11) move_cell(-1,0);
            else if (key == 13) begin_edit(0);
            else if (key == 12) clear_cell();
            else if (key == 131 || key == 6) { outp(0x00ef,0xa5); return 0; }
            else if (key == 133) help();
            else if (key == 123) start_fill(1);
            else if (key >= 32 && key < 127) { begin_edit(1); edit_buffer[0] = key; edit_buffer[1] = 0; edit_len = 1; edit_line(); }
        }
    }
}
