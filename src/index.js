const USERNAME = "syeobnn";     // 사용자 이름 입력
const REPO = "PS";              // GitHub repository 입력
const BASE_PATH = "백준";        // 기본 directory
const GITHUB_API_URL = `https://api.github.com/repos/${USERNAME}/${REPO}/contents/${BASE_PATH}`;
const TIER_DIRECTORIES = ["Bronze", "Silver", "Gold", "Platinum", "Diamond", "Ruby"];
const BAEK_HANDLE = "bsy309";    // 등록할 handle 입력하기

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
    "Authorization": `token ${env.GITHUB_API}`,
    "Accept": "application/vnd.github.v3+json",
    "User-Agent": "CloudflareWorkerBot"
});

const NOTION_HEADERS = env => ({
    "Authorization": `Bearer ${env.NOTION_API}`,
    "Content-Type": "application/json",
    "Notion-Version": "2022-02-22"
});

const getDatabaseId = env => env.NOTION_DB;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// GitHub에서 티어별 문제 번호 가져오기
async function takeGitProblems(env) {
    let resultDict = {};

    for (const tier of TIER_DIRECTORIES) {
        const tierUrl = `${GITHUB_API_URL}/${tier}`;
        const response = await fetch(tierUrl, { headers: GITHUB_HEADERS(env) });

        if (response.ok) {
            const items = await response.json();
            let numbers = [];

            for (const item of items) {
                if (item.type === "dir") { //directory에서 문제 번호를 추출함
                    const match = item.name.match(/^(\d+)/);
                    if (match) {
                        numbers.push(parseInt(match[1]));
                    }
                }
            }
            resultDict[tier] = numbers.sort((a, b) => a - b);
        } else {
            console.log(`${tier} 디렉토리를 가져오지 못함: ${response.status}`);
        }
    }
    return resultDict;
}

// Notion DB에서 기존 문제 번호 가져오기, 문제(url) 칼럼에서 숫자 추출
async function getExistingProblemIds(env, DATABASE_ID) {
  const url = `https://api.notion.com/v1/databases/${DATABASE_ID}/query`;
  const response = await fetch(url, { method: "POST", headers: NOTION_HEADERS(env) });

  if (response.ok) {
      const data = await response.json();
      
      //특정 사용자가 푼 문제만 필터링 (BAEK_HANDLE이 푼 문제 제외)
      return new Set(data.results
          .filter(item => {
              const url = item.properties["문제"]?.url;
              const solver = item.properties["푼 사람"]?.select?.name;
              const match = url ? url.match(/(\d+)$/) : null;
              const problemId = match ? parseInt(match[1]) : null;

              return problemId !== null && solver === BAEK_HANDLE;
          }) //notion DB에서 BAEK_HANDLE이 푼 문제만 필터링
          .map(item => {
              const url = item.properties["문제"]?.url;
              const match = url ? url.match(/(\d+)$/) : null;

              return match ? parseInt(match[1]) : null;
          }) //필터링 된 목록에서 문제 번호만 추출
      );
  } else {
      console.log(`Notion API 호출 실패: ${response.status}`);
      return new Set();
  }
}

// 문자열로 난이도 변환
function difficultyTransform(difficultyNumber) {
    const diff = ['bronze', 'silver', 'gold', 'platinum', 'diamond', 'ruby'];
    for (let i = 0; i < 6; i++) {
        if (difficultyNumber <= (i + 1) * 5) {
            return diff[i] + ' ' + (5 - (difficultyNumber + 4) % 5);
        }
    }
    return 'Not Ratable';
}

// Notion DB에 문제 추가
async function addProblemToNotion(env, problemId, problemInfo, DATABASE_ID) {
    const url = `https://api.notion.com/v1/pages`;

    const newPageData = {
        parent: { database_id: DATABASE_ID },
        properties: {
            "문제": { "url": `https://boj.kr/${problemId}` },
            "문제 제목": {
                "title": [{ "text": { "content": problemInfo.titleKo } }]
            },
            "난이도": {
                "select": { "name": difficultyTransform(problemInfo.level) }
            },
            "푼 사람": {
                "select": { "name": BAEK_HANDLE }
            },
            "푼 사람 수": {
                "number": problemInfo.acceptedUserCount
            },
            "알고리즘": {
                "multi_select": problemInfo.tags
                    .filter(tag => tag.displayNames?.length > 0)  
                    .map(tag => ({ "name": tag.displayNames[0].name }))
            },
            "언어": {
                "select": { "name": problemInfo.language || "한국어" }
            }
        }
    };

    const response = await fetch(url, { method: "POST", headers: NOTION_HEADERS(env), body: JSON.stringify(newPageData) });

    if (response.ok) {
        console.log(`Notion DB에 추가 완료: ${problemId}`);
    } else {
        console.log(`Notion 추가 실패: ${response.status}`);

        if (response.status === 401 || response.status === 403) {
            console.error("API 키 또는 권한 확인 필요.");
        } else {
            console.error(`Notion API 호출 실패 (Status: ${response.status})`);
        }
    }
}

// Solved.ac API에서 문제 정보 가져오기
async function getProblemInfo(problemId) {
  const url = `https://solved.ac/api/v3/problem/show?problemId=${problemId}`;
  const headers = { "x-solvedac-language": "ko" };
  const response = await fetch(url, { headers });

  if (response.ok) {
      return await response.json();
  } else {
      console.log(`Solved.ac API 호출 실패: ${problemId} (status: ${response.status})`);
      return null;
  }
}

// Notion DB에 없는 문제만 추가
async function addProblemListToNotion(env) {
  const DATABASE_ID = getDatabaseId(env);
  const resultDict = await takeGitProblems(env);
  const existingProblemIds = await getExistingProblemIds(env, DATABASE_ID);

  for (const [tier, problemList] of Object.entries(resultDict)) {
      for (const problemId of problemList) {
          if (!existingProblemIds.has(problemId)) {  // 특정 사용자가 푼 문제 제외
              const problemInfo = await getProblemInfo(problemId);
              if (problemInfo) {
                  console.log(`${BAEK_HANDLE}의 미해결 문제 추가 중: ${problemId}`);
                  await addProblemToNotion(env, problemId, problemInfo, DATABASE_ID);
                  await sleep(1000);  // 1초 대기 (API 요청 제한 방지)
              }
          }
      }
  }
}