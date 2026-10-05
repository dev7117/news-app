import ReactMarkdown from "react-markdown";
import { Link } from "react-router-dom";

/** Safe markdown (no raw HTML). Links open in a new tab. */
export default function Markdown({ children, className = "" }: { children: string; className?: string }) {
  return (
    <div className={`md ${className}`}>
      <ReactMarkdown
        components={{
          // Screenshots: shown at a readable size, click for full size.
          img: ({ src, alt }) =>
            src?.startsWith("uploading-") ? (
              <span className="text-sm text-faint">Uploading image…</span>
            ) : (
              <a href={src} target="_blank" rel="noreferrer" className="md-image" onClick={(e) => e.stopPropagation()}>
                <img src={src} alt={alt ?? ""} loading="lazy" />
              </a>
            ),
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
