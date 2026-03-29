export default function PhotographerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="h-screen w-screen overflow-hidden relative">
      {children}
    </div>
  );
}
