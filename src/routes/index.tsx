import { createFileRoute } from "@tanstack/react-router";
import { Atelier } from "@/components/atelier";

export const Route = createFileRoute("/")({ component: Atelier });
