// Part A - queries
//
// One thing to know before you start: this database stores grades on the
// American letter scale (A, A-, B+, ...), because that is the scale it came
// with. We use the Danish 7-point scale everywhere else, so the conversion
// happens in the database, in the danish_grade function you wrote in Task 5
// of the database exercises. Every query below that returns a grade calls it.
//
// Three rules for every query here:
//   values go in as $1, $2, never joined into the SQL text
//   columns are renamed for TypeScript: tot_cred AS "totCred"
//   numeric columns are cast: tot_cred::int, count(*)::int
//
// The module structure of the lesson Building the data access layer comes
// later; for this assignment one file is enough.

import { pool } from './db.js';

export interface Student {
  id: string;
  name: string;
  deptName: string;
  totCred: number;
}

export interface CourseRow {
  courseId: string;
  title: string;
  grade: string | null;
}

export interface DeptCount {
  deptName: string;
  students: number;
}

// --- A1. Reading ----------------------------------------------------------

/** A page of students, ordered by id. */
export async function listStudents(limit: number, offset: number): Promise<Student[]> {
  const result = await pool.query<Student>(
    `SELECT id, name, dept_name AS "deptName", tot_cred::int AS "totCred"
     FROM student
     ORDER BY id
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return result.rows;
}
/*
$1 and $2: the limit and offset go in as parameters in the array, never joined into the SQL string.
dept_name AS "deptName": the quotes keep the camelCase. Without them PostgreSQL lowercases it to deptname and TypeScript wouldn’t match.
tot_cred::int: tot_cred is a numeric column, and pg returns numerics as strings, so the cast makes it a real number.
ORDER BY id: a page only makes sense with a stable order.
*/

/** One student, or undefined when there is no such id. */
export async function findStudent(id: string): Promise<Student | undefined> {
  const result = await pool.query<Student>(
    `SELECT id, name, dept_name AS "deptName", tot_cred::int AS "totCred"
     FROM student
     WHERE id = $1`,
    [id]
  );
  return result.rows[0];
}
/*
WHERE id = $1: the id goes in as a parameter, so a value like '1; DROP TABLE student' is treated as plain text and never as SQL.
result.rows[0]: rows is an array. When no student matches it is empty, and [0] on an empty array gives undefined, which is exactly what the return type promises. You don’t need an if.
Why not LIMIT 1: id is the primary key, so at most one row can match anyway.
 */

/** The students of one department, ordered by name. */
export async function studentsIn(deptName: string): Promise<Student[]> {
  const result = await pool.query<Student>(
    `SELECT id, name, dept_name AS "deptName", tot_cred::int AS "totCred"
     FROM student
     WHERE dept_name = $1
     ORDER BY name`,
    [deptName]
  );
  return result.rows;
}

/*
WHERE dept_name = $1: the department name is a parameter, so a value with a quote in it, like O'Brien Dept, can’t break the query.
ORDER BY name: the task asks for name order. If two students share a name, add , id after name so the order is always the same.
Returns an array: for a department with no students, rows is an empty array, which is the right answer here (unlike findStudent, where “none” is undefined).
 */

// --- A2. A join -----------------------------------------------------------

/**
 * The courses a student takes, with the grade, ordered by course id.
 * Two tables: takes and course. A student who takes nothing gives an empty
 * array, not an error.
 *
 * The grade must come back on the Danish scale, so call danish_grade from
 * the database exercises inside the query:
 *
 *     SELECT ..., danish_grade(t.grade) AS grade
 */
export async function coursesFor(studentId: string): Promise<CourseRow[]> {
  const result = await pool.query<CourseRow>(
    `SELECT c.course_id AS "courseId", c.title, danish_grade(t.grade) AS grade
     FROM takes t
     JOIN course c ON c.course_id = t.course_id
     WHERE t.id = $1
     ORDER BY c.course_id`,
    [studentId]
  );
  return result.rows;
}
/*
JOIN course c ON c.course_id = t.course_id: takes only holds the course id, so the join fetches the title.
No LEFT JOIN needed: a student who takes nothing simply has no matching takes rows, so rows is an empty array, as the task asks.
danish_grade(t.grade) AS grade: the conversion happens in the query, as the assignment says. grade is already lowercase, so it needs no quotes.
c.title: it needs no alias because it is already lowercase.
Parameter: the student id is $1, never joined into the string.
*/

// --- A3. Aggregating ------------------------------------------------------

/**
 * How many students each department has, ordered by department name.
 * Without the cast, count(*) arrives as a string. Try it both ways and
 * look at the type of what you get.
 */
export async function studentsPerDepartment(): Promise<DeptCount[]> {
  const result = await pool.query<DeptCount>(
    `SELECT dept_name AS "deptName", count(*)::int AS students
     FROM student
     GROUP BY dept_name
     ORDER BY dept_name`
  );
  return result.rows;
}

/*
GROUP BY dept_name: one output row per department, with count(*) counting the students in each group.
count(*)::int: count returns a bigint, and pg hands bigints back as strings ("3", not 3) because they can exceed JavaScript’s safe integer range. The cast makes it a real number. To see the difference the task asks about, run it once without ::int and print typeof rows[0].students. You’ll get string instead of number.
AS students: no quotes needed, because it’s already lowercase and matches the DeptCount field.
No parameters: nothing from outside goes into the query, so the [] array can be left out.
Students without a department: dept_name can be NULL in the schema (on delete set null), and those students would show up as one group with deptName null. It doesn’t happen with your current data, but it explains why the type is string in the interface and not string | null.
 */

// --- A4. Writing ----------------------------------------------------------

/** Stores a student and returns the row the database stored. */
export async function insertStudent(student: Student): Promise<Student> {
  const result = await pool.query<Student>(
    `INSERT INTO student (id, name, dept_name, tot_cred)
     VALUES ($1, $2, $3, $4)
     RETURNING id, name, dept_name AS "deptName", tot_cred::int AS "totCred"`,
    [student.id, student.name, student.deptName, student.totCred]
  );
  return result.rows[0];
}

/*
RETURNING: gives back the row as the database stored it, so you don’t need a second SELECT. It follows the same rules as the reads: AS "deptName" keeps the camelCase and tot_cred::int makes the number a real number.
Parameters: all four values go in as $1 to $4, with the column list spelled out so the order of the values can’t be mixed up.
rows[0]: an INSERT that succeeds always returns exactly one row, so no undefined case here.
Errors: a duplicate id throws a primary key violation, and a deptName that doesn’t exist in department throws a foreign key violation. The function lets these propagate, since the task doesn’t ask you to handle them.

*/

/** True when a row was deleted, false when there was nothing to delete. */
export async function deleteStudent(id: string): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM student WHERE id = $1`,
    [id]
  );
  return (result.rowCount ?? 0) > 0;
}

/*
result.rowCount: the number of rows the DELETE removed. 1 means there was a student and it’s gone, 0 means nothing matched. That maps straight to true / false.
?? 0: in the pg typings rowCount can be null, so this keeps TypeScript happy.
Cascade: in your schema takes and advisor have on delete cascade on the student, so deleting a student also deletes their enrolments and advisor row. Worth knowing if you explain this one.
 */