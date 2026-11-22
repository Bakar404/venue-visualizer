// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useEffect, useState } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, commandFilter } from "@/components/ui/command";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView ??= function () {};
});
afterEach(cleanup);

function Palette() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) setOpen((o) => !o);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  return (
    <CommandDialog open={open} onOpenChange={setOpen} title="Command palette">
      <CommandInput placeholder="Search…" />
      <CommandList>
        <CommandEmpty>Nothing found.</CommandEmpty>
        <CommandGroup heading="Go to">
          <CommandItem>Garden terrace</CommandItem>
          <CommandItem>Render all photos</CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}

describe("CommandDialog", () => {
  it("opens on ⌘K with a working input and list", () => {
    render(<Palette />);
    expect(screen.queryByPlaceholderText("Search…")).toBeNull();

    fireEvent.keyDown(document, { key: "k", metaKey: true });

    const input = screen.getByPlaceholderText("Search…");
    expect(screen.getByRole("listbox")).toBeTruthy();
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Garden terrace", "Render all photos"]);

    fireEvent.change(input, { target: { value: "render" } });
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Render all photos"]);
  });
});

describe("commandFilter", () => {
  it("requires every word instead of a fuzzy subsequence", () => {
    expect(commandFilter("Garden terrace", "rndr")).toBe(0);
    expect(commandFilter("Render all photos", "render")).toBe(1);
    expect(commandFilter("Render all photos", "photos all")).toBe(0.5);
    expect(commandFilter("Switch engine", "codex", ["Codex CLI"])).toBe(0.5);
    expect(commandFilter("Anything", "  ")).toBe(1);
  });
});
