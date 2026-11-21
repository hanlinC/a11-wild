import type { Role } from "@a11-wild/shared";
import type { Item, Table } from "../store/table.js";

const PK = "USER";

export interface User {
  sub: string;
  email: string;
  role: Role;
  disabled: boolean;
}

interface UserItem extends Item {
  email: string;
  role: Role;
  disabled?: boolean;
}

/** A person may use the studio only when an invitation made a row for them. */
export async function findActiveUser(table: Table, sub: string): Promise<User | undefined> {
  const item = await table.get<UserItem>(PK, sub);
  if (!item || item.disabled === true) return undefined;
  return { sub, email: item.email, role: item.role, disabled: false };
}

export function userItem(user: Omit<User, "disabled">): Item {
  return { pk: PK, sk: user.sub, email: user.email, role: user.role };
}
