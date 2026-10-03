# Top 5 Teams Showcase

A 3D countdown (Three.js) that reveals the top 5 teams from **#5 to #1**. Each team's planet explodes into particles, the particles form a screen, the members are introduced one by one, and the camera zooms in so the demo video fills the window. When the video ends, it zooms back out for the next team.

## Run it

Double-click **`start.command`**. It starts the local server and opens the show in your browser.

Or run it from a terminal:

```bash
python3 server.py
```

Opening `index.html` directly does not work. The page has to be served (data and images load over HTTP). It needs internet the first time to load Three.js, GSAP and fonts from a CDN.

## Add your content

| What | Where |
|---|---|
| Team names, projects, members, tech | `data/teams.json` |
| Member photos (square works best) | `img/…` (the `photo` path in `teams.json`). Missing photos show initials |
| Background music (optional) | `audio/music.mp3` |
| Event title / finale text | `event` block in `data/teams.json` |

The show no longer plays demo videos: after the stone explodes, the team's members are shown.

### Using one team photo for all members

You don't need a separate photo for each person. Give the team one group photo and say where each person's face is (in % from the left and from the top of the photo). The show cuts each member out of it automatically:

```json
{
  "rank": 1,
  "photo": "img/team1.png",
  "members": [
    { "name": "Dara",  "role": "Team Leader", "face": { "x": 16.7, "y": 24.7 } },
    { "name": "Sokha", "role": "Developer",   "face": { "x": 48.8, "y": 24.7 } }
  ]
}
```

- **Find x / y:** open the photo in Preview, point at the middle of a face, and divide the position by the photo's width (x) or height (y), then × 100. Example: face at 136 px in an 812 px wide photo → x = 16.7.
- **Zoom:** add `"photoZoom": 2.5` to the team to show more of the body, or `4` for a closer face shot (default 3.2).
- If a member has their own `"photo"`, it's used instead of the crop.

**Video tips:** MP4 (H.264), 1080p. Videos play for **at most 1 minute**, fading out over the last 2 seconds. To change that, add `"videoMax": 90` (seconds) to a team, or to `event` for all teams.

## Controls

| Key | Action |
|---|---|
| → / Space / Enter / PageDown | Next |
| ← / PageUp | Back |
| R | Replay current video |
| Z / click the scene | Zoom the video in (fills the window) / out |
| F | Fullscreen video (good if the projector makes the 3D screen hard to see) |
| M | Mute music |
| H | Hide shortcuts panel |

Presentation clickers send PageDown/PageUp, so they work too. Press your browser's fullscreen (Ctrl+Cmd+F on Mac) before presenting.

## Tweak the look

At the top of `js/main.js`:

- `RANK_STYLE`: each rank's color, position in space, and screen size
- `BLOOM_NORMAL` / `BLOOM_VIDEO`: glow strength
- `MUSIC_VOLUME`
