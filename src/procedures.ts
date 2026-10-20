// Part B2 and B3 - calling what you wrote in the database
//
// Write the routines in procedures.sql first, in pgAdmin. Calling them is an
// ordinary query: a FUNCTION goes inside a SELECT, a PROCEDURE uses CALL.

import { pool } from './db.js';

export interface TranscriptRow {
  courseId: string;
  title: string;
  grade: string | null;
}

/**
 * The transcript of a student, from the stored function:
 *
 *     SELECT * FROM student_transcript($1)
 *
 * The function raises an exception for an unknown student, which arrives
 * here as a rejected promise. Let it travel on: this one throws.
 */
export async function transcriptOf(studentId: string): Promise<TranscriptRow[]> {
  const result = await pool.query<TranscriptRow>(
    `SELECT course_id AS "courseId", title, grade
     FROM student_transcript($1)`,
    [studentId]
  );
  return result.rows;
}

/**
 * The same, but undefined instead of an error when the student does not
 * exist.
 *
 * An exception you raised yourself arrives with err.code === 'P0001'. Any
 * other code is a real failure and must be re-thrown rather than swallowed:
 * a syntax error in your SQL is not "no such student".
 */
export async function transcriptOrUndefined(
  studentId: string): Promise<TranscriptRow[] | undefined> {
  try {
    return await transcriptOf(studentId);
  } catch (err) {
    if ((err as { code?: string }).code === 'P0001') {
      return undefined;
    }
    throw err;
  }
}

/**
 * Enrols a student by calling the stored procedure:
 *
 *     CALL enrol_student($1, $2, $3, $4, $5, NULL)
 *
 * The INOUT parameter comes back as a row. Note that tot_cred is numeric, so
 * the new total arrives as a string: convert it.
 *
 * Returns the new credit total.
 */
export async function enrolWithProcedure(
  studentId: string, courseId: string, secId: string,
  semester: string, year: number): Promise<number> {
  const result = await pool.query<{ new_total: string }>(
    `CALL enrol_student($1, $2, $3, $4, $5, NULL)`,
    [studentId, courseId, secId, semester, year]
  );
  return Number(result.rows[0].new_total);
}

/*
CALL with an INOUT parameter: PostgreSQL returns one row whose column is named after the INOUT parameter, here new_total. That’s why you read rows[0].new_total.
Number(...): new_total is numeric, and pg returns numerics as strings ("3"), so the conversion gives a real number. This is the same reason as tot_cred::int in the queries, but here you can’t cast inside the SQL, because the value comes out of the procedure itself.
Parameters: the five values go in as $1 to $5. The NULL for the INOUT slot is written directly in the SQL, as the comment shows.
Transactions: you don’t need BEGIN/COMMIT here. The procedure runs as a single statement, so the insert and the update succeed or fail together. If the course doesn’t exist, the procedure raises an exception, and a missing student fails on the foreign key. In both cases nothing is changed, and the error reaches the caller.
*/



/*
TypeScript (B1): The logic sits with the rest of the code, so it is easy to read, test, debug and change in one deploy. 
The cost is more round trips to the database, and any other program that writes to the database has to repeat the rule or can skip it.

Stored procedure (B3): The rule runs inside the database in one call, so it applies to every client. 
The cost is that the logic lives outside the main code, so it is harder to version, test and debug, and it is tied to PostgreSQL.

My choice: I would keep the logic in TypeScript, as this course does, so there is one place to maintain it. The cost is that the database does not protect itself, because another client could add an enrolment without updating tot_cred.
The routine has to be deployed to the database separately from the code, and the application fails if that step is forgotten.
*/