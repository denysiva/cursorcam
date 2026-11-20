# Art and sound

Everything visual and audible in the game was generated through Higgsfield and then processed by `build-assets.py` into `app/public/img` and `app/public/sfx`. The raw files (`design/raw`, about 45 MB) are not committed.

## Look

Art deco tarot under a night sky. Deep indigo and plum, antique gold line work, saffron orange for the Sun team, icy cyan for the Moon team, crimson on black for the BAN card.

Every image prompt ends with the same style formula, word for word, which is what keeps the set consistent:

> Art deco tarot card illustration in a screen-print linocut style: bold flat shapes, crisp fine antique-gold line engraving, limited palette of deep midnight indigo, plum violet and metallic antique gold plus one accent color, perfectly symmetrical composition, elegant geometric deco ornaments, subtle printed paper grain, premium collectible card game art. No text, no letters, no numbers, no watermark.

## Images (GPT Image 2.6, high quality)

| Raw file | Shipped as | Subject |
| --- | --- | --- |
| `sun.png` | `card-sun.webp` | A radiant sun with a calm face, alternating straight and wavy rays |
| `moon.png` | `card-moon.webp` | A crescent moon with a face in profile, clouds and stars |
| `bot.png` | `card-bot.webp` | A wind-up tin toy robot shrugging, gears floating around |
| `ban.png` | `card-ban.webp` | A hooded figure raising a gavel in front of a crimson prohibition sign |
| `hero.png` | `hero.webp` | The Oracle, half lit warm and half cool, presenting a fan of cards |
| `oracle-sun.png` | `oracle-sun.webp` | The Sun Oracle, bust, sun-ray crown |
| `oracle-moon.png` | `oracle-moon.webp` | The Moon Oracle, bust, crescent headdress and starry veil |
| `avatars.png` | `avatars.webp` | 4×4 sheet of animal medallions: fox, owl, cat, raven, wolf, hare, bear, deer, snake, frog, moth, koi, rooster, goat, hedgehog, octopus |
| `icon.png` | `icon-*.png`, `favicon.png` | An eye whose iris is half sun, half moon |
| `cover.png` | `og.jpg` | Wide key art: the Oracle over a grid of glowing cards |

## Sound

Effects come from Mirelo SFX, the music loop from ElevenLabs Music v2.5; the interface blips (tap, tick, pop) are synthesised in the browser.

| File | Prompt, in short |
| --- | --- |
| `flip.mp3` | A single playing card flipping on felt |
| `good.mp3` | Bright ascending celesta and glass bell chime |
| `miss.mp3` | Low wooden thud and a descending two-note marimba |
| `bot.mp3` | Wind-up ratchet and two confused toy-robot beeps |
| `ban.mp3` | Huge deep gong, hammer slam, sub drop |
| `clue.mp3` | Airy rising swell ending in a crystal bell |
| `turn.mp3` | One warm singing-bowl strike |
| `win.mp3` | Short brass and harp victory fanfare |
| `music.mp3` | 75 s downtempo ambient loop: warm pads, celesta, kalimba, soft percussion |
