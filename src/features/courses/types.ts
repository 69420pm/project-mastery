/** A Course as the Course list shows it. */
export type CourseListItem = {
  id: string;
  name: string;
};

/** A Material as the Materials page lists it. */
export type MaterialListItem = {
  id: string;
  name: string;
  mediaType: string;
  sizeBytes: number;
  /** When it was uploaded, as an ISO timestamp. */
  createdAt: string;
};

/** A Course in the Course list, with what deleting it takes along. */
export type CourseWithCounts = CourseListItem & {
  /** How many Chats the Course holds. */
  chatCount: number;
  /** How many Materials the Course holds. */
  materialCount: number;
};
