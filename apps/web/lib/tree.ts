/** The sub-lease tree under one lease (E-020), read level by level with `list_sub_leases`. */
import type { LeaseView } from "./lease-view.ts";

/** Most sub-leases one page shows (one view call each); a demo tree is a handful. */
export const TREE_CAP = 40;

export interface TreeNode {
  readonly lease: LeaseView;
  readonly children: TreeNode[];
}

/** Breadth first, so a capped tree still shows the levels nearest the lease. */
export async function loadTree(
  children: (leaseId: string) => Promise<LeaseView[]>,
  rootId: string,
  cap = TREE_CAP,
): Promise<{ nodes: TreeNode[]; truncated: boolean }> {
  const nodes: TreeNode[] = [];
  const queue: [string, TreeNode[]][] = [[rootId, nodes]];
  let count = 0;
  let truncated = false;
  for (let next = queue.shift(); next; next = queue.shift()) {
    const [id, into] = next;
    for (const lease of await children(id)) {
      if (count >= cap) {
        truncated = true;
        break;
      }
      const n: TreeNode = { lease, children: [] };
      into.push(n);
      count += 1;
      queue.push([lease.lease_id, n.children]);
    }
    if (truncated) break;
  }
  return { nodes, truncated };
}

/** What a sub-lease's line says about it; under a revoked lease, why it is refused. */
export function treeStatus(l: LeaseView, aboveRevoked: boolean): string {
  if (aboveRevoked) return "refused: a lease above was revoked";
  if (l.status === "revoked") return "revoked";
  if (l.status === "used_up") return "all calls used (here or above)";
  return l.status;
}
