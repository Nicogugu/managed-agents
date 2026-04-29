import { Fragment, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  type ChatMessage,
  type Mode,
  type PublishState,
  type WpDraft,
  assistantText,
} from "../types";
import { extractAsks, extractDrafts, extractPlans, stripBlocks } from "../parseDraft";
import { ToolCallRow } from "./ToolCallRow";
import { AskCard } from "./AskCard";
import { PlanCard } from "./PlanCard";
import { DraftCard } from "./DraftCard";

export function MessageBubble({
  message,
  mode,
  onPublish,
  onAnswerAsk,
  askAnsweredFor,
  publishedFor,
  onApprovePlan,
  disabled,
}: {
  message: ChatMessage;
  mode: Mode;
  onPublish: (draft: WpDraft) => void;
  onAnswerAsk: (askIdx: number, label: string, value: string) => void;
  askAnsweredFor: (askIdx: number) => string | undefined;
  publishedFor: (draftIdx: number) => PublishState | undefined;
  onApprovePlan: () => void;
  disabled: boolean;
}) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="bg-accent/15 border border-accent/30 text-text-primary rounded-2xl rounded-br-md px-3.5 py-2 max-w-[85%] sm:max-w-[75%] whitespace-pre-wrap text-md">
          {message.text}
        </div>
      </div>
    );
  }

  // Texte cumulé pour extraire les blocs spéciaux (wp-plan, wp-post, ask).
  // Note: ces extracteurs s'appliquent au texte total, pas par block —
  // l'agent peut splitter un bloc JSON sur plusieurs events texte.
  const fullText = useMemo(() => assistantText(message), [message]);
  const drafts = useMemo(() => extractDrafts(fullText), [fullText]);
  const plans = useMemo(() => extractPlans(fullText), [fullText]);
  const asks = useMemo(() => extractAsks(fullText), [fullText]);

  // On compte les indices au fil de l'eau pour mapper les Draft/Plan/Ask
  // au bon ordre du flux et garder le keying stable.
  let draftIdx = 0;
  let planIdx = 0;
  let askIdx = 0;

  return (
    <div className="flex flex-col gap-2 max-w-[92%] sm:max-w-[85%]">
      {message.blocks.map((block, i) => {
        if (block.type === "tool") {
          return <ToolCallRow key={`b-${i}`} call={block.call} />;
        }
        // Block texte — on extrait les éléments spéciaux qu'il contient pour
        // les rendre comme cartes spécialisées DANS l'ordre chronologique,
        // et on affiche le texte restant en bulle markdown.
        const blockDrafts = extractDrafts(block.text);
        const blockPlans = extractPlans(block.text);
        const blockAsks = extractAsks(block.text);
        const visible = stripBlocks(block.text);
        const elements: JSX.Element[] = [];
        if (visible) {
          elements.push(
            <div
              key={`b-${i}-text`}
              className="surface rounded-2xl rounded-bl-md px-3.5 py-2.5 text-md leading-relaxed text-text-primary markdown-body"
            >
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{visible}</ReactMarkdown>
            </div>,
          );
        }
        for (const plan of blockPlans) {
          const idx = planIdx++;
          elements.push(
            <PlanCard
              key={`b-${i}-plan-${idx}`}
              plan={plan}
              onApprove={onApprovePlan}
              disabled={disabled}
            />,
          );
        }
        for (const draft of blockDrafts) {
          const idx = draftIdx++;
          elements.push(
            <DraftCard
              key={`b-${i}-draft-${idx}`}
              draft={draft}
              mode={mode}
              onPublish={() => onPublish(draft)}
              published={publishedFor(idx)}
            />,
          );
        }
        for (const ask of blockAsks) {
          const idx = askIdx++;
          elements.push(
            <AskCard
              key={`b-${i}-ask-${idx}`}
              ask={ask}
              onClick={(label, value) => onAnswerAsk(idx, label, value)}
              answered={askAnsweredFor(idx)}
              disabled={disabled}
            />,
          );
        }
        return <Fragment key={`b-${i}`}>{elements}</Fragment>;
      })}
      {/* Garde-fou pour les futurs cas où on aurait des blocs hors text/tool */}
      {void [drafts, plans, asks]}
    </div>
  );
}
