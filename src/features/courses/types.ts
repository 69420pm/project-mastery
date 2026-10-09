/** A Course as the Course list shows it. */
export type CourseListItem = {
  id: string;
  name: string;
};

/** A Course in the Course list, with what deleting it takes along. */
export type CourseWithCounts = CourseListItem & {
  /** How many Chats the Course holds. */
  chatCount: number;
};
