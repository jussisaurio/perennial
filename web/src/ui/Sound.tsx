import { useEffect, useState } from "react";
import { isSoundOn, onSoundChange, setSoundOn } from "./speech";
import { SpeakerIcon, SpeakerOffIcon } from "./icons";

export function useSound(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(isSoundOn);
  useEffect(() => onSoundChange(setOn), []);
  return [on, setSoundOn];
}

/** An icon button in the session bar that turns all sound on or off. Its label shows like the plants toggle's. */
export function SoundToggle() {
  const [on, set] = useSound();
  return (
    <button className="icon" onClick={() => set(!on)} aria-pressed={!on} aria-label="Mute sound" data-tip={on ? "Sound: on" : "Sound: off"}>
      {on ? <SpeakerIcon size={20} /> : <SpeakerOffIcon size={20} />}
    </button>
  );
}
