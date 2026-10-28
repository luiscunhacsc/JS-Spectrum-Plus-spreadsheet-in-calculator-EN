#ifndef SPECTRUM_CALC_H
#define SPECTRUM_CALC_H
#define ROWS 64
#define COLS 8
#define TEXT 32
#define COUNT (ROWS*COLS)
#define VIEW 16
extern char sheet_cells[COUNT][TEXT], message[64];
extern unsigned char sheet_row, sheet_col, sheet_top, sheet_left, sheet_ready, editing;
extern unsigned char fill_mode, fill_row, fill_col;
extern unsigned char help_active;
void bars(void);
void draw(void);
void recalculate(void);
void refresh_cells(void);
void refresh_attrs(void);
void move_cell(int dr,int dc);
void commit_edit(void);
void begin_edit(unsigned char clear);
void clear_cell(void);
void help(void);
unsigned int read_key(void);
void start_fill(unsigned char mode);
void cancel_fill(void);
void apply_fill(void);
unsigned char in_fill_range(unsigned char row,unsigned char col);
unsigned int poll_mouse(void);
#endif
