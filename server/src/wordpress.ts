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

export type WpPostSummary = {
  id: number;
  title: string;
  status: string;
  slug: string;
  date: string;
  excerpt: string;
  link: string;
};

export async function listPosts(opts: {
  status?: string;
  per_page?: number;
  search?: string;
} = {}): Promise<WpPostSummary[]> {
  const params = new URLSearchParams();
  params.set("status", opts.status || "any");
  params.set("per_page", String(opts.per_page ?? 50));
  if (opts.search) params.set("search", opts.search);
  // _fields limite la taille de la réponse
  params.set("_fields", "id,title,status,slug,date,excerpt,link");

  const res = await fetch(`${baseUrl()}/wp-json/wp/v2/posts?${params}`, {
    headers: { Authorization: authHeader() },
  });
  if (!res.ok) {
    throw new Error(`WP list failed (${res.status}): ${await res.text()}`);
  }
  const raw = (await res.json()) as Array<{
    id: number;
    title: { rendered: string };
    status: string;
    slug: string;
    date: string;
    excerpt: { rendered: string };
    link: string;
  }>;
  return raw.map((p) => ({
    id: p.id,
    title: p.title.rendered,
    status: p.status,
    slug: p.slug,
    date: p.date,
    excerpt: p.excerpt.rendered.replace(/<[^>]+>/g, "").trim(),
    link: p.link,
  }));
}

export async function getPost(id: number) {
  const res = await fetch(`${baseUrl()}/wp-json/wp/v2/posts/${id}`, {
    headers: { Authorization: authHeader() },
  });
  if (!res.ok) {
    throw new Error(`WP get failed (${res.status}): ${await res.text()}`);
  }
  return res.json();
}

export type WpTaxonomyItem = { id: number; name: string; slug: string; count: number };

export async function listCategories(): Promise<WpTaxonomyItem[]> {
  const res = await fetch(
    `${baseUrl()}/wp-json/wp/v2/categories?per_page=100&_fields=id,name,slug,count`,
    { headers: { Authorization: authHeader() } },
  );
  if (!res.ok) throw new Error(`WP categories failed (${res.status}): ${await res.text()}`);
  return res.json();
}

export async function listTags(search?: string): Promise<WpTaxonomyItem[]> {
  const params = new URLSearchParams({
    per_page: "50",
    _fields: "id,name,slug,count",
    orderby: "count",
    order: "desc",
  });
  if (search) params.set("search", search);
  const res = await fetch(`${baseUrl()}/wp-json/wp/v2/tags?${params}`, {
    headers: { Authorization: authHeader() },
  });
  if (!res.ok) throw new Error(`WP tags failed (${res.status}): ${await res.text()}`);
  return res.json();
}

export type WpMediaItem = {
  id: number;
  source_url: string;
  alt_text: string;
  title: string;
  date: string;
  mime_type: string;
};

export async function listMedia(perPage = 20): Promise<WpMediaItem[]> {
  const res = await fetch(
    `${baseUrl()}/wp-json/wp/v2/media?per_page=${perPage}&_fields=id,source_url,alt_text,title,date,mime_type`,
    { headers: { Authorization: authHeader() } },
  );
  if (!res.ok) throw new Error(`WP media failed (${res.status}): ${await res.text()}`);
  const raw = (await res.json()) as Array<any>;
  return raw.map((m) => ({
    id: m.id,
    source_url: m.source_url,
    alt_text: m.alt_text || "",
    title: m.title?.rendered || "",
    date: m.date,
    mime_type: m.mime_type,
  }));
}

/**
 * Convenience wrapper used by meta_update({ featured_media_url }) — fetch the
 * remote image, upload to WP, return {id, source_url}.
 */
export async function uploadMediaFromUrl(url: string, filename?: string) {
  const src = await fetch(url);
  if (!src.ok) throw new Error(`fetch image failed (${src.status}) for ${url}`);
  const buf = Buffer.from(await src.arrayBuffer());
  const ct = src.headers.get("content-type") || "application/octet-stream";
  const guessed =
    filename ||
    url.split("/").pop()?.split("?")[0] ||
    `upload-${Date.now()}.${ct.split("/")[1] || "bin"}`;
  return uploadMedia({ data: buf, filename: guessed, mimeType: ct });
}

export async function uploadMedia(opts: {
  data: Buffer;
  filename: string;
  mimeType: string;
  altText?: string;
  title?: string;
}): Promise<WpMediaItem> {
  const res = await fetch(`${baseUrl()}/wp-json/wp/v2/media`, {
    method: "POST",
    headers: {
      Authorization: authHeader(),
      "Content-Type": opts.mimeType,
      "Content-Disposition": `attachment; filename="${opts.filename}"`,
    },
    // Buffer -> Uint8Array pour compat fetch (BodyInit n'accepte pas Buffer en TS strict)
    body: new Uint8Array(opts.data),
  });
  if (!res.ok) throw new Error(`WP media upload failed (${res.status}): ${await res.text()}`);
  const created = (await res.json()) as any;

  // Optionnel: enrichir avec alt text + title via PUT (l'upload initial accepte pas tous les champs)
  if (opts.altText || opts.title) {
    await fetch(`${baseUrl()}/wp-json/wp/v2/media/${created.id}`, {
      method: "POST",
      headers: {
        Authorization: authHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        alt_text: opts.altText,
        title: opts.title,
      }),
    });
  }
  return {
    id: created.id,
    source_url: created.source_url,
    alt_text: opts.altText || "",
    title: opts.title || created.title?.rendered || "",
    date: created.date,
    mime_type: created.mime_type,
  };
}

// Anti-duplicate guard: même slug POSTé < 60s → on retourne le post déjà créé.
const recentBySlug = new Map<string, { id: number; link: string; ts: number }>();
const DEDUP_WINDOW_MS = 60_000;

export async function createPost(input: WpPostInput) {
  const slug = input.slug;
  if (slug) {
    const prev = recentBySlug.get(slug);
    if (prev && Date.now() - prev.ts < DEDUP_WINDOW_MS) {
      console.warn(
        `[wp] dedup: slug="${slug}" déjà créé il y a ${Math.round(
          (Date.now() - prev.ts) / 1000,
        )}s → retour du post existant ${prev.id}`,
      );
      return { id: prev.id, link: prev.link, _deduped: true } as any;
    }
  }

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
  const result = (await res.json()) as { id: number; link: string };
  if (slug) {
    recentBySlug.set(slug, { id: result.id, link: result.link, ts: Date.now() });
  }
  return result;
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
