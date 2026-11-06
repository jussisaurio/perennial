import { useEffect, useState } from "react";
import { isSoundOn, onSoundChange, setSoundOn } from "./speech";
import { SpeakerIcon, SpeakerOffIcon } from "./icons";

export function useSound(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(isSoundOn);
  useEffect(() => onSoundChange(setOn), []);
  return [on, setSoundOn];
}

/** An icon button that turns all sound on or off. In the session bar its label shows like the plants toggle's (`tip`). */
export function SoundToggle({ className = "icon", size = 20, tip = false }: { className?: string; size?: number; tip?: boolean }) {
  const [on, set] = useSound();
  const label = tip ? { "data-tip": on ? "Sound: on" : "Sound: off" } : { title: on ? "Sound is on. Click to turn it off." : "Sound is off. Click to turn it on." };
  return (
    <button className={className} onClick={() => set(!on)} aria-pressed={!on} aria-label="Mute sound" {...label}>
      {on ? <SpeakerIcon size={size} /> : <SpeakerOffIcon size={size} />}
    </button>
  );
}
