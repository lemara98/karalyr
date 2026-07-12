import { SearchBox } from "@/components/SearchBox";

export default function HomePage() {
  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold">Find karaoke lyrics</h1>
      <p className="mb-6 text-sm text-zinc-500">
        Word-level timed lyrics with community corrections. Free and open API.
      </p>
      <SearchBox />
    </div>
  );
}
