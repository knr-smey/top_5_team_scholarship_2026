# Top 5 Teams Showcase: Ideas

## Core concept: a countdown reveal, like an awards show

Go from **#5 up to #1**. Each reveal builds up a bit of suspense, shows the team, and then plays their demo video on screen. Save the biggest effect for #1.

```
[Intro scene] → #5 → #4 → #3 → #2 → #1 (grand finale) → [All 5 teams together]
```

---

## Idea 1: "Galaxy of Projects" (top pick)

- **Background:** a 3D starfield of particles that drifts slowly as the camera moves.
- **Each team is a glowing planet or crystal** floating in space, and you can't see which team it is yet.
- **On reveal:**
  1. The camera flies toward the planet (GSAP tween).
  2. The planet breaks into particles, and the particles regroup into a **floating 3D screen**.
  3. The team's **demo video plays on that 3D screen** (Three.js `VideoTexture`).
  4. The rank number (#3, for example), team name, members and project title fly in as 3D text.
- **For #1:** gold particle explosion, a confetti shower, a lens-flare/bloom glow, and a bigger screen.

## Idea 2: "Podium Stage"

- A dark 3D stage with spotlights.
- Five podiums of different heights, all covered by a curtain or fog at the start.
- On reveal, a spotlight sweeps over and lands on the podium. The team appears as avatar cards, and a big screen behind them rises up and plays the video.
- At the end, all five teams are on the podiums together for a final shot.

## Idea 3: "Floating Card Carousel"

- Five glass-style cards arranged in a 3D ring.
- The ring rotates to bring each team to the front. The card flips, scales up to fullscreen, and the video plays.
- This is the simplest one to build and still looks premium.

---

## Each team's reveal sequence (about 30 to 45 seconds)

| Step | What shows | Animation |
|---|---|---|
| 1 | "RANK #3" | Number zooms in with a glitch or glow effect |
| 2 | Team name + project name | Letters animate in one by one |
| 3 | Team member photos | Avatars pop in in a circle around the screen |
| 4 | **Demo video (15–30s)** | Video screen morphs in and plays |
| 5 | Short stats (score, tech used) | Small badges float up |
| 6 | Transition | Camera pulls back, particles flow to the next team |

---

## Tech stack

| Purpose | Tool |
|---|---|
| Framework | **React + Vite** (or Next.js) |
| 3D | **Three.js** via **React Three Fiber** + **@react-three/drei** |
| Animation timing | **GSAP** (timeline-based, good for sequences) |
| Glow effects | **@react-three/postprocessing** (Bloom, ChromaticAberration) |
| Confetti | `canvas-confetti` or Three.js particles |
| Data | One `teams.json` file |

### Data shape

```json
[
  {
    "rank": 1,
    "teamName": "Code Warriors",
    "project": "Smart Scholarship Finder",
    "members": [
      { "name": "Dara", "photo": "/img/dara.jpg" },
      { "name": "Sokha", "photo": "/img/sokha.jpg" }
    ],
    "video": "/videos/team1.mp4",
    "score": 98,
    "tech": ["React", "Node.js", "AI"]
  }
]
```

### How the video goes on a 3D screen (the key trick)

```jsx
import { useVideoTexture } from '@react-three/drei'

function VideoScreen({ src }) {
  const texture = useVideoTexture(src, { muted: false, loop: false, start: true })
  return (
    <mesh>
      <planeGeometry args={[16 / 2, 9 / 2]} />
      <meshBasicMaterial map={texture} toneMapped={false} />
    </mesh>
  )
}
```

---

## Practical tips

1. **Browser autoplay rule:** browsers block video with sound until the user clicks something. Add a **"Start Show" button** at the beginning, and that one click unlocks sound for the whole show.
2. **Presenter controls:** use the **→ / Space** keys to move to the next team. That works better than auto-play when someone is presenting live.
3. **Video format:** MP4 (H.264), 720p, under 20MB each, 15–30 seconds. Preload the next video while the current one plays.
4. **Fallback:** if the 3D screen looks blurry on the projector, add an option to switch the video to a fullscreen HTML `<video>` over the 3D scene.
5. **Music:** low background music that fades down when a demo video plays and comes back up after.

---

## Open questions

1. Which style: **Galaxy**, **Podium Stage**, **Card Carousel**, or a mix?
2. **Presented live** on a projector at an event, or a **website** people visit on their own?
3. Are the videos and team photos ready?
4. React, or plain HTML/JS?
