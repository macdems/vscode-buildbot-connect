export const BUILD_RESULTS_DESCRIPTIONS = [
    "completed successfully",
    "completed with warnings",
    "failed",
    "was skipped",
    "stopped with exception",
    "has been retried",
    "was cancelled",
];

export interface Build {
    buildid: number; // the unique ID of this build
    number: number; // the number of this build (sequential for a given builder)
    builderid: number; // id of the builder for this build
    buildrequestid: number; // build request for which this build was performed, or None if no such request exists
    workerid: number; // the worker this build ran on
    masterid: number; // the master this build ran on
    started_at: Date; // time at which this build started
    complete: boolean; // true if this build is complete Note that this is a calculated field (from complete_at != None).
    complete_at?: Date; // time at which this build was complete, or None if it’s still running
    properties?: {}; // a dictionary of properties attached to build.
    results?: number; // the results of the build (see Build Result Codes), or None if not complete
    state_string: string; // a string giving detail on the state of the build.
}

export interface Builder {
    builderid: number; // ID of this builder
    description?: string; // description for that builder
    masterids: number[]; // ID of the masters this builder is running on
    name: string; // builder name
    tags?: string[]; // list of tags for this builder
    last_build: Build; // [extension] builds retrieved for this builder
}

export interface ForceField {
    default?: string;
    fullName?: string,
    label: string;
    name?: string;
    type: string;
    required: boolean;
    hide?: boolean;
    // multiple: boolean;
    // regex: string,
    fields?: ForceField[]
}