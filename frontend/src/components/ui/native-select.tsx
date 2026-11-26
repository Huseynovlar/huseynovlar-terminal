import { SearchSelect, type SearchSelectProps } from "@/components/ui/search-select";

/** Legacy name kept for imports: renders the custom searchable combobox (no browser-native dropdown anywhere). */
function NativeSelect(props: SearchSelectProps) {
  return <SearchSelect {...props} />;
}

export { NativeSelect };
