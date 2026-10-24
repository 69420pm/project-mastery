import { expect, test } from "vitest";
import {
  COURSE_LIST_PATH,
  coursePath,
  materialChunksPath,
  materialsPath,
} from "./course-paths";

const COURSE = "aaaaaaaa-0000-4000-8000-000000000001";
const MATERIAL = "bbbbbbbb-0000-4000-8000-000000000002";

test.each([
  ["the Course list", COURSE_LIST_PATH, "/courses"],
  ["a Course", coursePath(COURSE), `/courses/${COURSE}/map`],
  ["its Materials", materialsPath(COURSE), `/courses/${COURSE}/materials`],
  [
    "a Material's chunks",
    materialChunksPath(COURSE, MATERIAL),
    `/courses/${COURSE}/materials/${MATERIAL}`,
  ],
])("the path of %s", (_case, path, expected) => {
  expect(path).toBe(expected);
});
