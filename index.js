const USERNAME = "syeobnn";     //사용자 이름 입력
const REPO = "PS";              //github repository입력
const BASE_PATH = "백준";        //기본 directory
const GITHUB_API_URL = `https://api.github.com/repos/${USERNAME}/${REPO}/contents/${BASE_PATH}`;
const TIER_DIRECTORIES = ["Bronze", "Silver", "Gold", "Platinum"];
const BAEK_HANDLE = "bsy309";    //등록할 handle 입력하기

export default {
    // cron triggered
    async scheduled(event, env, ctx) {
      console.log("cron starting");
      try {
        await addProblemListToNotion(env);
        console.log("실행 완료");
      } catch (error) {
        console.error("실행 중 오류 발생:", error);
      }
    },
  
    // fetch가 없으면 실행이 되지 않아 임의로 작성
    async fetch() {
      return new Response("Cloudflare Workers 실행 중", { status: 200 });
    }
  };
  
  // 환경 변수에서 API 키 가져오기
  const GITHUB_HEADERS = env => ({
    "Authorization": `token ${env.github_api}`,
    "Accept": "application/vnd.github.v3+json",
    "User-Agent": "CloudflareWorkerBot"
  });
  
  const NOTION_HEADERS = env => ({
    "Authorization": `Bearer ${env.notion_api}`,
    "Content-Type": "application/json",
    "Notion-Version": "2022-02-22"
  });
  
  const getDatabaseId = env => env.notion_db;
  
  // GitHub에서 티어별 문제 번호 가져오기
  async function takeGitProblems(env) {
    let resultDict = {};

    for (const tier of TIER_DIRECTORIES) {
      const tierUrl = `${GITHUB_API_URL}/${tier}`;
      //console.log(tierUrl);
      const response = await fetch(tierUrl, { headers: GITHUB_HEADERS(env) }); //문제 티어별 디렉토리의 파일 및 목록
      //console.log(response);

      if (response.ok) {
        //console.log(`${tierUrl} im okay\n`);
        const items = await response.json();
        let numbers = [];
  
        for (const item of items) {
          if (item.type === "dir") { //굳이 다른거 필요없고 디렉토리 이름에서 문제 번호만 가져옴
            const match = item.name.match(/^(\d+)/);
            if (match) {
              numbers.push(parseInt(match[1]));
            }
          }
        }
        resultDict[tier] = numbers.sort((a, b) => a - b); //오름차순 정렬 후 dictionary형태로 저장
      } else {
        console.log(`${tier} 디렉토리를 가져오지 못함: ${response.status}`);
      }
    }
    return resultDict;
  }
  
  // Notion DB에서 기존 문제 번호 가져오기
  async function getExistingProblemIds(env, DATABASE_ID) {
    const url = `https://api.notion.com/v1/databases/${DATABASE_ID}/query`;
    const response = await fetch(url, { method: "POST", headers: NOTION_HEADERS(env) }); //notion db정보
  
    if (response.ok) {
      //console.log("notiondb im okay\n");
      const data = await response.json();
      return new Set(data.results.map(item => item.properties["문제 번호"].number)); //문제 많아지면 느려져서 Set
    } else {
      console.log(`Notion API 호출 실패: ${response.status}`);
      return new Set();
    }
  }
  
  // Solved.ac API에서 문제 정보 가져오기
  async function getProblemInfo(problemId) {
    const url = `https://solved.ac/api/v3/problem/show?problemId=${problemId}`;
    const headers = { "x-solvedac-language": "ko" };
  
    const response = await fetch(url, { headers }); //문제 별 정보
  
    if (response.ok) {
      //console.log("solved im okay\n");
      return await response.json();
    } else {
      console.log(`Solved.ac API 호출 실패: ${problemId} (status: ${response.status})`);
      return null;
    }
  }
  
  // Notion DB에 문제 추가
  async function addProblemToNotion(env, problemId, tier, problemInfo, DATABASE_ID) {
    const url = `https://api.notion.com/v1/pages`;
  
    const newPageData = {
      parent: { database_id: DATABASE_ID },
      properties: {
        "문제 번호": { number: problemId },
        "문제 제목": { title: [{ text: { content: problemInfo.titleKo } }] },
        "푼 사람": { rich_text: [{ type: "text", text: { content: BAEK_HANDLE } }] },
        "난이도": { select: { name: String(problemInfo.level) } },
        "푼 사람 수": { number: problemInfo.acceptedUserCount },
        "알고리즘": {
          multi_select: problemInfo.tags.map(tag => ({ name: tag.displayNames[0].name }))
        },
        "문제 링크": { url: `https://www.acmicpc.net/problem/${problemId}` },
        "티어": { select: { name: tier } }
      }
    };
  
    const response = await fetch(url, { method: "POST", headers: NOTION_HEADERS(env), body: JSON.stringify(newPageData) });
  
    if (response.ok) {
      console.log(`Notion DB에 추가 완료: ${problemId} (${tier})`);
    } else {
      console.log(`Notion DB에 추가 실패: ${response.status}`);
    }
  }
  
  async function addProblemListToNotion(env) {
    const DATABASE_ID = getDatabaseId(env);
    const resultDict = await takeGitProblems(env);
    const existingProblemIds = await getExistingProblemIds(env, DATABASE_ID);
  
    for (const [tier, problemList] of Object.entries(resultDict)) {
      for (const problemId of problemList) {
        if (!existingProblemIds.has(problemId)) { // Notion에 없는 문제만 추가
          const problemInfo = await getProblemInfo(problemId);
          if (problemInfo) {
            await addProblemToNotion(env, problemId, tier, problemInfo, DATABASE_ID);
          }
        }
      }
    }
  }