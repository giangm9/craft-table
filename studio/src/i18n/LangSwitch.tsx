// The viewer's language switch: each language named in its own language, so anyone finds theirs. Picking one writes
// the ct_lang cookie and reloads the page (setLang). Placed in the sidebar's foot (main.tsx; also the phone's
// board-list drawer) and in the headers of /versions (VersionsPage.tsx) and /spec (spec-entry.tsx).
import { Select } from "../../ui";
import { lang, setLang, type Lang } from "./index";
import { T } from "./shell";

const NAMES: Record<Lang, string> = { en: "English", vi: "Tiếng Việt" };

export function LangSwitch({ className }: { className?: string }) {
  return (
    <Select<Lang>
      className={className}
      ariaLabel={T.language}
      value={lang}
      onChange={(l) => { if (l !== lang) setLang(l); }}
      options={(["en", "vi"] as const).map((l) => ({ value: l, label: NAMES[l] }))}
    />
  );
}
