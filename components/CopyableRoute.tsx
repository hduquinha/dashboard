const VOZUP_DOMAIN = "https://www.escolavozup.com";

export default function CopyableRoute({ route }: { route: string }) {
  const fullUrl = `${VOZUP_DOMAIN}${route}`;

  return (
    <a
      href={fullUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="vrm-rota"
      title="Abrir rota"
    >
      {fullUrl}
    </a>
  );
}
