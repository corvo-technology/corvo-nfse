// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DataTable, type Column } from "@/components/ui/data-table";

type Row = { id: string; name: string };
const rows: Row[] = [{ id: "a", name: "Ana" }, { id: "b", name: "Bruno" }];
const columns: Column<Row>[] = [{ id: "name", header: "Name", primary: true, cell: (r) => r.name }];
afterEach(cleanup);

describe("DataTable expanded row and row class", () => {
  it("puts the expanded content right under its row, once", () => {
    render(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} caption="people" expandedKey="a" renderExpanded={(r) => <p>editing {r.name}</p>} />);
    expect(screen.getAllByText("editing Ana")).toHaveLength(1);
    const cell = screen.getByText("editing Ana").closest("tr");
    expect(cell?.previousElementSibling?.textContent).toContain("Ana");
    expect(screen.queryByText("editing Bruno")).toBeNull();
  });

  it("marks rows with the class the caller asks for", () => {
    render(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} caption="people" rowClassName={(r) => (r.id === "b" ? "marked" : undefined)} />);
    const marked = document.querySelectorAll(".marked");
    expect(marked.length).toBeGreaterThan(0);
    expect(Array.from(marked).every((el) => el.textContent?.includes("Bruno"))).toBe(true);
  });

  it("renders as before when nothing is expanded", () => {
    render(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} caption="people" />);
    expect(screen.getAllByText("Ana").length).toBeGreaterThan(0);
  });
});
