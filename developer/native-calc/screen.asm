; Fast 4x8 text, writing the Spectrum bitmap and attribute RAM directly.
SECTION code_user
PUBLIC _character
PUBLIC _cell_edge
EXTERN _glyphs

_character:
    push ix
    ld ix,0
    add ix,sp
    ld b,(ix+8)             ; character row
    ld c,(ix+10)            ; character column
    ld a,b
    and 24
    add a,64
    ld h,a
    ld a,c
    srl a
    ld e,a
    ld a,b
    and 7
    rrca
    rrca
    rrca
    or e
    ld l,a
    push hl                 ; bitmap scanline 0
    ld h,0
    ld l,b
    add hl,hl
    add hl,hl
    add hl,hl
    add hl,hl
    add hl,hl
    ld d,0
    add hl,de
    ld de,22528
    add hl,de
    ld a,(ix+4)
    ld (hl),a
    pop de
    ld a,(ix+6)
    cp 97
    jr c,character_upper
    cp 123
    jr nc,character_upper
    sub 32
character_upper:
    cp 32
    jr c,character_unknown
    cp 96
    jr c,character_glyph
character_unknown:
    ld a,63
character_glyph:
    sub 32
    ld c,a
    ld b,0
    ld h,b
    ld l,c
    add hl,hl
    add hl,hl
    add hl,bc
    ld bc,_glyphs
    add hl,bc
    xor a
    call character_nibble
    ld a,5
character_lines:
    push af
    ld a,(hl)
    inc hl
    add a,a
    call character_nibble
    pop af
    dec a
    jr nz,character_lines
    xor a
    call character_nibble
    xor a
    call character_nibble
    pop ix
    ret
character_nibble:
    ld c,a
    ld a,(de)
    bit 0,(ix+10)
    jr z,character_even
    and 240
    or c
    jr character_store
character_even:
    and 15
    ld b,a
    ld a,c
    rlca
    rlca
    rlca
    rlca
    or b
character_store:
    ld (de),a
    inc d
    ret

; Seven bytes wide: dotted row rule and a one-pixel right cell boundary.
; The glyph pixels remain untouched, including the thirteenth character.
_cell_edge:
    push ix
    ld ix,0
    add ix,sp
    ld a,(ix+4)
    and 24
    add a,64
    ld h,a
    ld a,(ix+6)
    srl a
    ld c,a
    ld a,(ix+4)
    and 7
    rrca
    rrca
    rrca
    or c
    add a,6
    ld l,a
    ld b,7
cell_edge_vertical:
    set 0,(hl)
    inc h
    djnz cell_edge_vertical
    ld b,7
cell_edge_bottom:
    ld (hl),17
    dec l
    djnz cell_edge_bottom
    pop ix
    ret
