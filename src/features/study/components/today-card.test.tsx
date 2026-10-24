import { render, screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import type { TopicPlan } from "@/features/study/domain/plan";
import type { TodayPlan } from "@/features/study/domain/today";
import { TodayCard } from "./today-card";

const topic = { id: "t1" } as TopicPlan;

const renderCard = (
  today: Partial<TodayPlan>,
  plan: { hasMap?: boolean; topics?: TopicPlan[] } = {},
  startHref: string | null = "/courses/c1/chat",
) =>
  render(
    <TodayCard
      plan={{
        hasMap: true,
        topics: [topic],
        today: { reviews: null, next: null, hint: null, ...today },
        ...plan,
      }}
      mapHref="/courses/c1/map"
      topicHref="/courses/c1/map/t1"
      startHref={startHref ?? undefined}
    />,
  );

test("shows the due reviews, the next Topic with its link, the hint and Start", () => {
  renderCard({
    reviews: { count: 3, minutes: 6 },
    next: {
      id: "t1",
      name: "Nozzles",
      centralQuestion: "How does a nozzle speed up its gas?",
      kcs: [],
    },
    hint: "Practice exam-style problems",
  });

  const card = screen.getByRole("region", { name: "Today" });
  expect(card).toHaveTextContent("3 reviews due, about 6 min");
  expect(within(card).getByRole("link", { name: "Nozzles" })).toHaveAttribute(
    "href",
    "/courses/c1/map/t1",
  );
  expect(card).toHaveTextContent("How does a nozzle speed up its gas?");
  expect(card).toHaveTextContent("Practice exam-style problems");
  expect(within(card).getByRole("link", { name: "Start" })).toHaveAttribute(
    "href",
    "/courses/c1/chat",
  );
});

test.each([
  [{ hasMap: false }, "Build your Course map"],
  [{ topics: [] }, "Update your Course map"],
])("without a map or Topics says to build or update it (%o)", (plan, text) => {
  renderCard({}, plan);

  const card = screen.getByRole("region", { name: "Today" });
  expect(within(card).getByRole("link", { name: text })).toHaveAttribute(
    "href",
    "/courses/c1/map",
  );
  expect(within(card).queryByRole("link", { name: "Start" })).toBeNull();
});

test("has no Start without a link to start, as in a new Chat", () => {
  renderCard({}, {}, null);

  expect(screen.getByRole("region", { name: "Today" })).toHaveTextContent(
    "Nothing planned for today.",
  );
  expect(screen.queryByRole("link", { name: "Start" })).toBeNull();
});
