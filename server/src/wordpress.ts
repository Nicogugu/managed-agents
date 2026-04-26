const { WP_BASE_URL, WP_USER, WP_APP_PASSWORD } = process.env;

function authHeader() {
  if (!WP_USER || !WP_APP_PASSWORD) {
    throw new Error("WP_USER and WP_APP_PASSWORD must be set in .env");
  }
  const token = Buffer.from(`${WP_USER}:${WP_APP_PASSWORD}`).toString("base64");
  return `Basic ${token}`;
}

function baseUrl() {
  if (!WP_BASE_URL) throw new Error("WP_BASE_URL must be set in .env");
  return WP_BASE_URL.replace(/\/$/, "");
}

export type WpPostInput = {
  title?: string;
  content?: string;
  excerpt?: string;
  status?: "publish" | "draft" | "pending" | "private";
  slug?: string;
  categories?: number[];
  tags?: number[] | string[];
};

async function resolveTagIds(tags: (number | string)[]): Promise<number[]> {
  const ids: number[] = [];
  for (const t of tags) {
    if (typeof t === "number") {
      ids.push(t);
      continue;
    }
    const search = await fetch(
      `${baseUrl()}/wp-json/wp/v2/tags?search=${encodeURIComponent(t)}`,
      { headers: { Authorization: authHeader() } },
    );
    const found = (await search.json()) as Array<{ id: number; name: string }>;
    const exact = found.find((x) => x.name.toLowerCase() === t.toLowerCase());
    if (exact) {
      ids.push(exact.id);
      continue;
    }
    const create = await fetch(`${baseUrl()}/wp-json/wp/v2/tags`, {
      method: "POST",
      headers: {
        Authorization: authHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: t }),
    });
    if (!create.ok) {
      throw new Error(`Failed to create tag "${t}": ${await create.text()}`);
    }
    const created = (await create.json()) as { id: number };
    ids.push(created.id);
  }
  return ids;
}

export async function createPost(input: WpPostInput) {
  const body: Record<string, unknown> = { ...input };
  if (input.tags) body.tags = await resolveTagIds(input.tags);

  const res = await fetch(`${baseUrl()}/wp-json/wp/v2/posts`, {
    method: "POST",
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`WP create failed (${res.status}): ${await res.text()}`);
  return res.json();
}

export async function updatePost(id: number, input: WpPostInput) {
  const body: Record<string, unknown> = { ...input };
  if (input.tags) body.tags = await resolveTagIds(input.tags);

  const res = await fetch(`${baseUrl()}/wp-json/wp/v2/posts/${id}`, {
    method: "POST",
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`WP update failed (${res.status}): ${await res.text()}`);
  return res.json();
}
