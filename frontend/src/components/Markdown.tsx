import ReactMarkdown from "react-markdown";

/** Safe markdown (no raw HTML). Links open in a new tab. */
export default function Markdown({ children, className = "" }: { children: string; className?: string }) {
  return (
    <div className={`md ${className}`}>
      <ReactMarkdown
        components={{
          a: ({ href, children: label }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {label}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
