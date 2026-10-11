import { useEffect, useState } from "react";
import { isSoundOn, onSoundChange, setSoundOn } from "./speech";
import { SpeakerIcon, SpeakerOffIcon } from "./icons";

export function useSound(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(isSoundOn);
  useEffect(() => onSoundChange(setOn), []);
  return [on, setSoundOn];
}

/** An icon button that turns all sound on or off. */
export function SoundToggle({ className = "icon", size = 20 }: { className?: string; size?: number }) {
  const [on, set] = useSound();
  return (
    <button className={className} onClick={() => set(!on)} aria-pressed={!on} aria-label="Mute sound" title={on ? "Sound is on. Click to turn it off." : "Sound is off. Click to turn it on."}>
      {on ? <SpeakerIcon size={size} /> : <SpeakerOffIcon size={size} />}
    </button>
  );
}
