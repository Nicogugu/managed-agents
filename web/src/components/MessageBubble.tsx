import { Fragment, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { type ChatMessage, assistantText } from "../types";
import { extractAsks, extractPlans, stripBlocks } from "../parseDraft";
import { ToolCallRow } from "./ToolCallRow";
import { AskCard } from "./AskCard";
import { PlanCard } from "./PlanCard";

export function MessageBubble({
  message,
  onAnswerAsk,
  askAnsweredFor,
  onApprovePlan,
  disabled,
}: {
  message: ChatMessage;
  onAnswerAsk: (askIdx: number, label: string, value: string) => void;
  askAnsweredFor: (askIdx: number) => string | undefined;
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

  const fullText = useMemo(() => assistantText(message), [message]);
  const plans = useMemo(() => extractPlans(fullText), [fullText]);
  const asks = useMemo(() => extractAsks(fullText), [fullText]);

  let planIdx = 0;
  let askIdx = 0;

  return (
    <div className="flex flex-col gap-2 max-w-[92%] sm:max-w-[85%]">
      {message.blocks.map((block, i) => {
        if (block.type === "tool") {
          return <ToolCallRow key={`b-${i}`} call={block.call} />;
        }
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
      {void [plans, asks]}
    </div>
  );
}
