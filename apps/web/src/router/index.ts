import { createRouter, createWebHistory } from 'vue-router'
const CapabilityPage=()=>import('../views/CapabilityPage.vue')
const ProjectsPage=()=>import('../views/ProjectsPage.vue')
const ProjectPage=()=>import('../views/ProjectPage.vue')
const ArchivePage=()=>import('../views/ArchivePage.vue')
const KnowledgePage=()=>import('../views/KnowledgePage.vue')
const MapPage=()=>import('../views/MapPage.vue')
const WorkflowPage=()=>import('../views/WorkflowPage.vue')
const ReportPage=()=>import('../views/ReportPage.vue')
const LibrariesPage=()=>import('../views/LibrariesPage.vue')

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/projects' },
    { path: '/projects', component: ProjectsPage },
    { path: '/projects/:id', component: ProjectPage },
    { path: '/map', component: MapPage },
    { path: '/archive', component: ArchivePage },
    { path: '/knowledge', component: KnowledgePage },
    { path: '/libraries', component: LibrariesPage },
    { path: '/workflow', component: WorkflowPage },
    { path: '/report', component: ReportPage },
    { path: '/:pathMatch(.*)*', component: CapabilityPage, props: { title: '页面不存在', capabilityId: '' } }
  ]
})
