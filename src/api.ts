export interface Builder {
    builderid: number;      // ID of this builder
    description?: string;   // description for that builder
    masterids: number[];    // ID of the masters this builder is running on
    name: string;           // builder name
    tags?: string[];        // list of tags for this builder
}