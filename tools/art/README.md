# Site art

Pictures are drawn by an image model and then **printed here**, never used straight from the model.

`riso.py` reprints a picture as a two-ink risograph on the site's paper: cream paper, black key ink and fluorescent
pink, the Webring palette. Each ink is a real halftone screen at its own angle, slightly out of register, with
uneven ink and paper grain. It throws away every colour the model chose, so gradients, glows and the in-between
colours that make generated images look generated do not survive.

```
pip install numpy scipy pillow
python tools/art/riso.py source.png out.png --width 560 --cell 4
```

Print at the size the picture is shown (twice its CSS size for sharp screens) so the dots stay visible.

Rules for new pictures:
- No people, animals or other characters, and no text, letters or numbers.
- Ask the model for flat, hand-made shapes (linocut, woodcut, ink). Grok Imagine 2.0 and Recraft V4.1 have printed
  best so far.
- Keep the model's source file outside the repo; commit only the printed result.
