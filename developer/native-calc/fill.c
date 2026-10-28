/* Formula copying, relative references and drag gestures execute on the Z80. */
#include <stdio.h>
#include <string.h>
#include <ctype.h>
#include <input.h>
#include "calc.h"

unsigned char fill_mode, fill_row, fill_col, fill_origin_row, fill_origin_col;
char fill_source[TEXT], fill_result[TEXT];
unsigned char mouse_previous;
unsigned int mouse_x,mouse_y;
unsigned char mouse_buttons;
unsigned char in_KempcoordX,in_KempcoordY,in_KemprawX,in_KemprawY;

unsigned char translate_formula(char *src,int dr,int dc) {
    unsigned char used,ac,ar;
    char *p,*digits,ref[8],*part;
    int row,col;
    used=0; p=src;
    if (*p!='=') { strcpy(fill_result,p); return 1; }
    while (*p) {
        part=p; ac=ar=0;
        if (*p=='$') { ac=1; p++; }
        if (toupper(*p)>='A' && toupper(*p)<='H' &&
            (part==src || (!isalnum(part[-1]) && part[-1]!='$'))) {
            col=toupper(*p++)-'A';
            if (*p=='$') { ar=1; p++; }
            digits=p; row=0;
            while (isdigit(*p)) { row=row*10+*p++-'0'; if (row>ROWS) break; }
            if (p!=digits && !isalpha(*p)) {
                if (!ac) col+=dc;
                if (!ar) row+=dr;
                if (col<0 || col>=COLS || row<1 || row>ROWS) { strcpy(fill_result,"=#REF!"); return 1; }
                sprintf(ref,"%s%c%s%d",ac?"$":"",'A'+col,ar?"$":"",row);
                digits=ref;
                while (*digits) { if (used>=TEXT-1) return 0; fill_result[used++]=*digits++; }
                continue;
            }
        }
        p=part;
        if (used>=TEXT-1) return 0;
        fill_result[used++]=*p++;
    }
    fill_result[used]=0; return 1;
}
unsigned char in_fill_range(unsigned char row,unsigned char col) {
    if (!fill_mode) return 0;
    if (row<fill_origin_row && row<fill_row) return 0;
    if (row>fill_origin_row && row>fill_row) return 0;
    if (col<fill_origin_col && col<fill_col) return 0;
    if (col>fill_origin_col && col>fill_col) return 0;
    return 1;
}
void start_fill(unsigned char mode) {
    if (!*sheet_cells[(unsigned int)sheet_row*COLS+sheet_col]) {
        strcpy(message,"SELECT A CELL WITH A VALUE OR FORMULA TO COPY."); bars(); return;
    }
    fill_origin_row=fill_row=sheet_row; fill_origin_col=fill_col=sheet_col;
    strcpy(fill_source,sheet_cells[(unsigned int)sheet_row*COLS+sheet_col]);
    fill_mode=mode;
    strcpy(message,"COPY REPLACES DESTINATION. ARROWS SELECT; ENTER APPLIES.");
    refresh_attrs(); bars();
}
void cancel_fill(void) {
    fill_mode=0; strcpy(message,"COPY CANCELLED."); refresh_attrs(); bars();
}
void apply_fill(void) {
    int r,c,r1,r2,c1,c2;
    unsigned char pass;
    r1=fill_origin_row; r2=fill_row; if (r1>r2) { r=r1; r1=r2; r2=r; }
    c1=fill_origin_col; c2=fill_col; if (c1>c2) { c=c1; c1=c2; c2=c; }
    /* Validate the whole rectangle before changing cells, including growth
       when a relative reference goes from row 9 to row 10. */
    for (pass=0;pass<2;pass++) for (r=r1;r<=r2;r++) for (c=c1;c<=c2;c++) {
        if (r==fill_origin_row && c==fill_origin_col) continue;
        if (!translate_formula(fill_source,r-fill_origin_row,c-fill_origin_col)) {
            fill_mode=0; strcpy(message,"COPY CANCELLED: A FORMULA EXCEEDS 31 CHARACTERS."); refresh_attrs(); bars(); return;
        }
        if (pass) strcpy(sheet_cells[(unsigned int)r*COLS+c],fill_result);
    }
    fill_mode=0; recalculate(); refresh_cells(); refresh_attrs();
    strcpy(message,"COPY COMPLETE."); bars();
}
unsigned int poll_mouse(void) {
    int row,col;
    unsigned char down,pressed,released;
    in_MouseKemp(&mouse_buttons,&mouse_x,&mouse_y);
    down=mouse_buttons&1;
    if (mouse_buttons&2) { if (fill_mode==2) cancel_fill(); mouse_previous=0; return 0; }
    pressed=down && !mouse_previous; released=!down && mouse_previous;
    mouse_previous=down;
    if (help_active) {
        return pressed && mouse_y>=184 ? 13 : 0;
    }
    if (pressed && !editing && !fill_mode && mouse_y>=8 && mouse_y<16) return 13;
    if (pressed && fill_mode!=2 && mouse_y>=24 && mouse_y<32) {
        if (mouse_x<44) return 13;
        if (mouse_x>=48 && mouse_x<92) {
            if (editing || fill_mode) return 6;
            return 12;
        }
        if (!editing && !fill_mode) {
            if (mouse_x>=96 && mouse_x<144) return 123;
            if (mouse_x>=144 && mouse_x<192) return 133;
            if (mouse_x>=200) return 131;
        }
        return 0;
    }
    if (pressed && fill_mode!=2 && mouse_y>=168 && mouse_y<176) {
        if (editing) commit_edit();
        if (mouse_x<12) move_cell(0,-4);
        else if (mouse_x>=32 && mouse_x<44) move_cell(0,4);
        else if (mouse_x>=128 && mouse_x<184) move_cell(-VIEW,0);
        else if (mouse_x>=192) move_cell(VIEW,0);
        return 0;
    }
    if (mouse_x>=16 && mouse_x<240 && mouse_y>=40 && mouse_y<168 && !editing) {
        row=sheet_top+(mouse_y>>3)-5;
        col=sheet_left+(mouse_x-16)/56;
        if (pressed) {
            if (fill_mode==1) move_cell(row-sheet_row,col-sheet_col);
            else if (row==sheet_row && col==sheet_col) {
                if ((mouse_x-16)%56>=52 && (mouse_y&7)>=5) start_fill(2);
                else return 13;
            } else if (!fill_mode) move_cell(row-sheet_row,col-sheet_col);
        }
        if (down && fill_mode==2 && (row!=fill_row || col!=fill_col)) {
            fill_row=row; fill_col=col; refresh_attrs();
        }
    } else if (pressed && editing && mouse_x>=16 && mouse_x<240 && mouse_y>=40 && mouse_y<168) {
        commit_edit(); move_cell(sheet_top+(mouse_y>>3)-5-sheet_row,sheet_left+(mouse_x-16)/56-sheet_col);
    }
    if (released && fill_mode==2) apply_fill();
    return 0;
}
