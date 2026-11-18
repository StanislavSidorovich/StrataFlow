// A teaching picture (the Gemini warehouse scene of the simulation lesson and card). Width-limited by its CSS and
// dropped from the layout when the file does not load (offline before the first visit, a blocked request): the text
// around it is complete without it.
import { useState } from 'react'
import './picture.css'

export interface PictureSpec {
  /** File name in `public/`. */
  file: string
  alt: string
}

export function Picture({ pic }: { pic: PictureSpec }) {
  const [failed, setFailed] = useState(false)
  if (failed) return null
  return <img className="teach-picture" src={`${import.meta.env.BASE_URL}${pic.file}`} alt={pic.alt} loading="lazy" decoding="async" onError={() => setFailed(true)} data-testid="teach-picture" />
}
