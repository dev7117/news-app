import type { Idea } from "../../lib/api";
import IdeaCard from "./IdeaCard";

export default function IdeaGrid({ ideas, showPlace = true }: { ideas: Idea[]; showPlace?: boolean }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
      {ideas.map((idea) => (
        <IdeaCard key={idea.id} idea={idea} showPlace={showPlace} />
      ))}
    </div>
  );
}
