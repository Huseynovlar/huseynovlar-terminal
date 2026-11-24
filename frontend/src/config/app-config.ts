import packageJson from "../../package.json";

const currentYear = new Date().getFullYear();

export const APP_CONFIG = {
  name: "Huseynovlar Terminal",
  shortName: "H-Terminal",
  domain: "terminal.huseynovlar.org",
  version: packageJson.version,
  copyright: `© ${currentYear}, Huseynovlar Terminal.`,
  meta: {
    title: "Huseynovlar Terminal — Exness MT5 Institutional Desk",
    description:
      "Personal Bloomberg-grade trading, analytics, AI news, and Docker MT5 operations terminal for Exness accounts.",
  },
};
