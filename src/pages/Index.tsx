// Index now redirects to ResearcherIDE which is mounted on "/"
// Kept as a passthrough so existing routes still resolve.
import ResearcherIDE from "./ResearcherIDE";
const Index = ResearcherIDE;
export default Index;
