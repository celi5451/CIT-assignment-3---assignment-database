// Part C - asynchronous code against a real database

import { pool } from './db.js';
import { findStudent, coursesFor, deleteStudent } from './queries.js';

export interface Overview {
  students: number;
  courses: number;
  departments: number;
}

// --- C1. Steps that depend on each other ----------------------------------

/**
 * The title of the first course a student takes, or undefined when the
 * student does not exist or takes nothing.
 *
 * Two steps, the second needing the first. Handle a missing student with
 * try/catch or with a check, and say in a comment which you chose and why.
 */
export async function firstCourseTitle(studentId: string): Promise<string | undefined> {
  const student = await findStudent(studentId);
  if (student === undefined) {
    return undefined;
  }

  const courses = await coursesFor(studentId);
  return courses[0]?.title;
}
  // I used a check, not try/catch: findStudent already returns undefined when
  // there is no such student, so a missing student is a normal, expected
  // result and not an error. try/catch is kept for real failures (lost
  // connection, bad SQL), which should still reach the caller.


// --- C2. Steps that do not depend on each other ---------------------------

/**
 * Three counts: students, courses, departments.
 *
 * Write it twice. overviewSlowly does one query after another; overview
 * starts all three together. The runner times both.
 *
 * Use this query, and note the pg_sleep: each count is made to take about
 * 200 ms on purpose.
 *
 *     SELECT pg_sleep(0.2), count(*)::int AS total FROM student
 *
 * Without it the three counts against a local database finish in about a
 * millisecond each, and starting them together costs more than it saves,
 * because the pool has to open two more connections. Waiting is what makes
 * the difference visible, and on a real server the waiting is real.
 */
async function count(table: 'student' | 'course' | 'department'): Promise<number> {
  const result = await pool.query<{ total: number }>(
    `SELECT pg_sleep(0.2), count(*)::int AS total FROM ${table}`
  );
  return result.rows[0].total;
}

export async function overviewSlowly(): Promise<Overview> {
  const students = await count('student');
  const courses = await count('course');
  const departments = await count('department');
  return { students, courses, departments };
}

export async function overview(): Promise<Overview> {
  const [students, courses, departments] = await Promise.all([
    count('student'),
    count('course'),
    count('department'),
  ]);
  return { students, courses, departments };
}

// --- C3. The forgotten await ----------------------------------------------

/**
 * Written for you, and wrong.
 *
 * It should delete a student and then report whether they are still there.
 * It reports that they are. Run it, explain in a comment what happens and
 * in which order, then write the corrected version below.
 *
 * There is a second problem, worse than the wrong answer: if the delete
 * fails, who finds out?
 */
export async function removeAndCheckBroken(id: string): Promise<boolean> {
  deleteStudent(id);
  const still = await findStudent(id);
  return still !== undefined;
}

// What happens, in order:
// 1. deleteStudent(id) is called, but there is no await. It starts the DELETE
//    and returns a promise, which is thrown away. The code does not wait.
// 2. findStudent(id) runs right away and is awaited. The DELETE has not
//    finished yet, so the SELECT still finds the student (and the two queries
//    may even run on different connections).
// 3. The function returns true: "still there", which is wrong.
//
// If the delete fails, nobody finds out. The rejected promise from
// deleteStudent is not awaited and has no .catch, so it becomes an unhandled
// rejection. The function itself still returns normally, and Node may
// crash the whole process later, far away from the code that caused it.

/** The same thing, correct: false when the student is really gone. */
export async function removeAndCheck(id: string): Promise<boolean> {
  await deleteStudent(id);
  const still = await findStudent(id);
  return still !== undefined;
}
