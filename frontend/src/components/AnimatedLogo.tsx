type AnimatedLogoProps = {
  sizeClassName?: string;
  imageClassName?: string;
};

const LOGO_VERSION = "20260404-1846";

export default function AnimatedLogo({
  sizeClassName = "w-36 h-36",
  imageClassName = "w-28 h-28",
}: AnimatedLogoProps) {
  return (
    <div className={`app-logo ${sizeClassName}`}>
      <div className="app-logo-ring" aria-hidden="true" />
      <div className="app-logo-glow" aria-hidden="true" />
      <img
        src={`/best-version/logo-192.png?v=${LOGO_VERSION}`}
        alt="Vibecraft logo"
        className={`app-logo-image ${imageClassName}`}
      />
    </div>
  );
}
