import {
  handleRecruitmentGet,
  handleRecruitmentPost,
} from "../../recruitment/recruitment-api";

export async function GET(request: Request) {
  return handleRecruitmentGet(request);
}
export async function POST(request: Request) {
  return handleRecruitmentPost(request);
}
