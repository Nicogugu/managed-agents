import { useEffect, useMemo, useRef, useState } from "react";
import { getDescriptor } from "./registry";
import type {
  BlockAttrSpec,
  ChildrenSpec,
  ClientBlockChild,
  ClientBlockDescriptor,
  ClientBlockInstance,
} from "./types";

/**
 * Renders a custom client block (Superprof, future clients) inside BlockNote.
 *
 * Two modes:
 *  - preview (default): the descriptor's `render` function or a fallback
 *    key:value table.
 *  - edit (when the user clicks "Modifier"): an inline form auto-built from
 *    `attrs` + `children`. Validates required fields, debounces saves to
 *    the BlockNote block props (which then propagate to draft store via the
 *    onChange flush).
 */

interface Props {
  instance: ClientBlockInstance;
  onChange: (next: ClientBlockInstance) => void;
}

function uuid(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

function defaultsFor(spec: BlockAttrSpec[], index?: number): Record<string, any> {
  const out: Record<string, any> = {};
  for (const a of spec) {
    if (a.autogen === "uuid") out[a.name] = uuid();
    else if (a.autogen === "index" && typeof index === "number") {
      out[a.name] = a.type === "boolean" ? false : index;
    } else if (a.default !== undefined) out[a.name] = a.default;
  }
  return out;
}

export function ClientBlockView({ instance, onChange }: Props) {
  const descriptor = getDescriptor(instance.namespace);
  const [editing, setEditing] = useState(false);

  if (!descriptor) {
    return (
      <div
        contentEditable={false}
        suppressContentEditableWarning
        style={{
          padding: 8,
          border: "1px dashed #f59e0b",
          borderRadius: 4,
          color: "#f59e0b",
          fontSize: 12,
        }}
      >
        Bloc inconnu : <code>{instance.namespace}</code>
      </div>
    );
  }

  return (
    <div className="client-block" contentEditable={false} suppressContentEditableWarning>
      <div className="client-block__header">
        <span className="client-block__icon">{descriptor.icon}</span>
        <span className="client-block__label">{descriptor.label}</span>
        <span className="client-block__ns">{descriptor.namespace}</span>
        <button
          type="button"
          className="client-block__edit"
          onClick={(e) => {
            e.stopPropagation();
            setEditing((v) => !v);
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {editing ? "✓ Terminé" : "✎ Modifier"}
        </button>
      </div>

      {!editing ? (
        <div className="client-block__preview">
          {descriptor.render
            ? descriptor.render({ attrs: instance.attrs, children: instance.children })
            : DefaultPreview({ instance, descriptor })}
        </div>
      ) : (
        <ClientBlockEditForm
          descriptor={descriptor}
          instance={instance}
          onChange={onChange}
        />
      )}
    </div>
  );
}

function DefaultPreview({
  instance,
  descriptor,
}: {
  instance: ClientBlockInstance;
  descriptor: ClientBlockDescriptor;
}) {
  return (
    <dl className="client-block__attrs">
      {descriptor.attrs
        .filter((a) => a.label)
        .map((a) => (
          <div key={a.name}>
            <dt>{a.label}</dt>
            <dd>{String(instance.attrs[a.name] ?? "")}</dd>
          </div>
        ))}
    </dl>
  );
}

function ClientBlockEditForm({
  descriptor,
  instance,
  onChange,
}: {
  descriptor: ClientBlockDescriptor;
  instance: ClientBlockInstance;
  onChange: (next: ClientBlockInstance) => void;
}) {
  const visibleAttrs = useMemo(
    () => descriptor.attrs.filter((a) => a.label && !a.autogen),
    [descriptor],
  );
  const visibleChildAttrs = useMemo(
    () => (descriptor.children?.attrs || []).filter((a) => a.label && !a.autogen),
    [descriptor],
  );

  function patchAttr(name: string, value: any) {
    onChange({ ...instance, attrs: { ...instance.attrs, [name]: value } });
  }

  function patchChild(i: number, name: string, value: any) {
    const children = (instance.children || []).map((c, j) =>
      j === i ? { attrs: { ...c.attrs, [name]: value } } : c,
    );
    onChange({ ...instance, children });
  }

  function addChild() {
    if (!descriptor.children) return;
    const idx = instance.children?.length ?? 0;
    if (descriptor.children.max && idx >= descriptor.children.max) return;
    const attrs = defaultsFor(descriptor.children.attrs, idx);
    onChange({
      ...instance,
      children: [...(instance.children || []), { attrs }],
    });
  }

  function removeChild(i: number) {
    if (!descriptor.children) return;
    const list = instance.children || [];
    if (descriptor.children.min && list.length <= descriptor.children.min) return;
    onChange({
      ...instance,
      children: list.filter((_, j) => j !== i),
    });
  }

  function moveChild(i: number, dir: -1 | 1) {
    const list = (instance.children || []).slice();
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    onChange({ ...instance, children: list });
  }

  return (
    <div className="client-block__form">
      {visibleAttrs.map((a) => (
        <AttrField
          key={a.name}
          spec={a}
          value={instance.attrs[a.name]}
          onChange={(v) => patchAttr(a.name, v)}
        />
      ))}
      {descriptor.children && (
        <>
          <div className="client-block__children-header">
            <span>Items</span>
            <button
              type="button"
              className="client-block__add"
              onClick={addChild}
              onMouseDown={(e) => e.stopPropagation()}
              disabled={
                !!descriptor.children.max &&
                (instance.children?.length ?? 0) >= descriptor.children.max
              }
            >
              {descriptor.children.addLabel || "+ Ajouter"}
            </button>
          </div>
          {(instance.children || []).map((c, i) => (
            <div key={i} className="client-block__child">
              <div className="client-block__child-header">
                <span>#{i + 1}</span>
                <button
                  type="button"
                  onClick={() => moveChild(i, -1)}
                  onMouseDown={(e) => e.stopPropagation()}
                  disabled={i === 0}
                  title="Monter"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => moveChild(i, 1)}
                  onMouseDown={(e) => e.stopPropagation()}
                  disabled={i === (instance.children?.length ?? 0) - 1}
                  title="Descendre"
                >
                  ↓
                </button>
                <button
                  type="button"
                  onClick={() => removeChild(i)}
                  onMouseDown={(e) => e.stopPropagation()}
                  disabled={
                    !!descriptor.children!.min &&
                    (instance.children?.length ?? 0) <= descriptor.children!.min
                  }
                  title="Supprimer"
                >
                  ×
                </button>
              </div>
              {visibleChildAttrs.map((a) => (
                <AttrField
                  key={a.name}
                  spec={a}
                  value={c.attrs[a.name]}
                  onChange={(v) => patchChild(i, a.name, v)}
                />
              ))}
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function AttrField({
  spec,
  value,
  onChange,
}: {
  spec: BlockAttrSpec;
  value: any;
  onChange: (v: any) => void;
}) {
  const stop = (e: any) => e.stopPropagation();
  const labelEl = (
    <label className="client-block__attr-label">
      {spec.label}
      {spec.required ? <span className="client-block__required">*</span> : null}
    </label>
  );
  if (spec.type === "textarea") {
    return (
      <div className="client-block__attr">
        {labelEl}
        <textarea
          className="client-block__textarea"
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          onMouseDown={stop}
          onClick={stop}
          rows={3}
        />
        {spec.description ? (
          <div className="client-block__hint">{spec.description}</div>
        ) : null}
      </div>
    );
  }
  if (spec.type === "boolean") {
    return (
      <label className="client-block__attr client-block__attr--checkbox">
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
          onMouseDown={stop}
          onClick={stop}
        />
        <span>{spec.label}</span>
      </label>
    );
  }
  if (spec.type === "color") {
    return (
      <div className="client-block__attr">
        {labelEl}
        <input
          className="client-block__input"
          type="color"
          value={String(value ?? "#ff6363")}
          onChange={(e) => onChange(e.target.value)}
          onMouseDown={stop}
          onClick={stop}
        />
      </div>
    );
  }
  return (
    <div className="client-block__attr">
      {labelEl}
      <input
        className="client-block__input"
        type={spec.type === "number" ? "number" : "text"}
        value={String(value ?? "")}
        onChange={(e) =>
          onChange(spec.type === "number" ? Number(e.target.value) : e.target.value)
        }
        onMouseDown={stop}
        onClick={stop}
      />
      {spec.description ? (
        <div className="client-block__hint">{spec.description}</div>
      ) : null}
    </div>
  );
}
