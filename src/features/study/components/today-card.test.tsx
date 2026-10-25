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
  expect(within(card).getByRole("link", { name: "Learn" })).toHaveAttribute(
    "href",
    "/courses/c1/chat?mode=learn",
  );
  expect(within(card).getByRole("link", { name: "Review" })).toHaveAttribute(
    "href",
    "/courses/c1/chat?mode=review",
  );
  expect(within(card).queryByRole("link", { name: "Practice" })).toBeNull();
});

const topicIn = (status: TopicPlan["status"], state: string) =>
  ({ id: "t", status, topicState: { state } }) as TopicPlan;

test.each([
  ["a learned in-plan Topic", [topicIn("in_plan", "learned")], true],
  ["a solid in-plan Topic", [topicIn("in_plan", "solid")], true],
  ["a needs-work in-plan Topic", [topicIn("in_plan", "needs_work")], true],
  ["only new Topics", [topicIn("in_plan", "new")], false],
  ["only an in-progress Topic", [topicIn("in_plan", "in_progress")], false],
  ["a learned Topic that is skipped", [topicIn("skipped", "learned")], false],
  [
    "a learned Topic outside the plan",
    [topicIn("if_time_allows", "learned")],
    false,
  ],
])("offers Practice per learned Topics: %s", (_, topics, offered) => {
  renderCard({}, { topics });

  const practice = screen.queryByRole("link", { name: "Practice" });
  if (offered) {
    expect(practice).toHaveAttribute("href", "/courses/c1/chat?mode=practice");
  } else {
    expect(practice).toBeNull();
  }
});

test("offers Review only with reviews due, and Learn only with a next Topic", () => {
  renderCard({ reviews: { count: 1, minutes: 2 } });

  expect(screen.getByRole("link", { name: "Review" })).toBeVisible();
  expect(screen.queryByRole("link", { name: "Learn" })).toBeNull();
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
  expect(within(card).queryByRole("link", { name: "Learn" })).toBeNull();
});

test("has no mode buttons without a link to start, as in a new Chat", () => {
  renderCard(
    {
      reviews: { count: 1, minutes: 2 },
      next: { id: "t1", name: "N", centralQuestion: "Q", kcs: [] },
    },
    {},
    null,
  );

  expect(screen.queryByRole("link", { name: "Learn" })).toBeNull();
  expect(screen.queryByRole("link", { name: "Review" })).toBeNull();
});
