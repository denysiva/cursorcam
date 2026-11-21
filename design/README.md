# Art and sound

Everything visual and audible in the game was generated through Higgsfield and then processed by `build-assets.py` into `app/public/img` and `app/public/sfx`. The raw files (`design/raw`, about 35 MB) are not committed. `design/screens` holds screenshots of the finished game.

## Look

A sunny Dominican beach in glossy 3D cartoon: a banana and coconuts in black sunglasses, white sand, palms, turquoise sea. The interface is a light "sticker" language on top of that scene: cream surfaces, thick navy outlines, hard offset shadows, banana yellow for one team and coconut brown for the other.

Every image prompt ends with the same style formula, which is what keeps the set consistent:

> Glossy 3D cartoon illustration in the style of a modern animated family movie: vibrant saturated colors, soft studio lighting with strong sun highlights, exaggerated friendly facial expressions, clean smooth shapes, high detail, Caribbean beach mood of the Dominican Republic. No text, no letters, no numbers, no watermark.

## Images (GPT Image 2.6, high quality)

File names keep the ids of the first theme (`sun`, `moon`, `bot`, `ban`, `oracle`), like the code does.

| Raw file | Shipped as | Subject |
| --- | --- | --- |
| `sun.png` | `card-sun.webp` | Banana in sunglasses giving a thumbs up (a Банани card) |
| `moon.png` | `card-moon.webp` | Grinning coconut in sunglasses (a Кокоси card) |
| `bot.png` | `card-bot.webp` | Sunburnt starfish tourist asleep on a towel (Турист) |
| `ban.png` | `card-ban.webp` | Shark bursting out of a stormy sea (Акула) |
| `hero.png` | `hero.webp` | Banana between two coconuts on the beach, Dominican flag behind |
| `oracle-sun.png` | `oracle-sun.webp` | Captain Banana in a captain's hat |
| `oracle-moon.png` | `oracle-moon.webp` | Captain Coconut in a captain's hat |
| `avatars.png` | `avatars.webp` | 4×4 sheet of medallions on a transparent background: pineapple, mango, parrot, flamingo, crab, turtle, toucan, iguana, starfish, watermelon, cocktail, dolphin, papaya, pelican, hermit crab, lime |
| `icon.png` | `icon-*.png`, `favicon.png` | Banana and coconut side by side |
| `cover.png` | `og.jpg` | Wide key art: the two teams facing off over cards on the sand |

## Sound

Effects come from Mirelo SFX, the music loop from ElevenLabs Music v2.5; the interface blips (tap, tick, pop) are synthesised in the browser.

| File | Prompt, in short |
| --- | --- |
| `flip.mp3` | A single playing card flipping on felt |
| `good.mp3` | Bright ascending celesta and glass bell chime |
| `miss.mp3` | Low wooden thud and a descending two-note marimba |
| `bot.mp3` | Ukulele slide down and a sleepy cartoon yawn |
| `ban.mp3` | Big splash, a comedic chomp and a low brass hit |
| `clue.mp3` | Airy rising swell ending in a crystal bell |
| `turn.mp3` | One warm singing-bowl strike |
| `win.mp3` | Short brass and harp victory fanfare |
| `music.mp3` | 75 s bachata and merengue flavoured beach loop: nylon guitar, bongos, güira, steel drums |
