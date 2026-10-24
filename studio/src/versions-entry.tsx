// The /versions page: managing versions (full copies of the whole app in the studio).
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../ui/tokens.css";
import "./studio.css";
import { VersionsPage } from "./VersionsPage";

createRoot(document.getElementById("root")!).render(<StrictMode><VersionsPage /></StrictMode>);
