import ReactMarkdown from "react-markdown";
import { Link } from "react-router-dom";

/** Safe markdown (no raw HTML). Links open in a new tab. */
export default function Markdown({ children, className = "" }: { children: string; className?: string }) {
  return (
    <div className={`md ${className}`}>
      <ReactMarkdown
        components={{
          a: ({ href, children: label }) => {
            const person = href?.match(/^#person-(\d+)$/);
            if (person)
              return (
                <Link to={`/people/${person[1]}`} className="mention" onClick={(e) => e.stopPropagation()}>
                  {label}
                </Link>
              );
            return (
              <a href={href} target="_blank" rel="noreferrer">
                {label}
              </a>
            );
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
