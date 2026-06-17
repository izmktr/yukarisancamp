import React from 'react';
import { BoardArticle } from './BoardList';
export type BoardDetailType = BoardArticle & {
    party: {
        name: string;
        star: number;
        level: number;
        rank: number;
    }[];
};
declare const BoardDetail: React.FC<{
    id: string;
}>;
export default BoardDetail;
//# sourceMappingURL=BoardDetail.d.ts.map