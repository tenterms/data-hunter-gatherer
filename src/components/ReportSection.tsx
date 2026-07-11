export default function ReportSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="card">
      <h2>{title}</h2>
      {description && <p className="section-desc">{description}</p>}
      {children}
    </section>
  );
}
