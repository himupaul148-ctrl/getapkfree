/** Shared shell for the static content pages. */
export default function Prose({
  title,
  intro,
  children,
}: {
  title: string;
  intro?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
      <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{title}</h1>
      {intro && <p className="mt-3 text-base leading-relaxed text-fg-muted sm:mt-4 sm:text-lg">{intro}</p>}
      <div className="mt-10 space-y-6 leading-relaxed text-fg-muted [&_a]:text-brand-400 [&_a:hover]:underline [&_h2]:mt-10 [&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-fg [&_li]:ml-5 [&_li]:list-disc [&_ol_li]:list-decimal [&_strong]:text-fg">
        {children}
      </div>
    </div>
  );
}
