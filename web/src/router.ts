import { createRouter, createWebHistory } from 'vue-router';
import CallView from './views/CallView.vue';
import HomeView from './views/HomeView.vue';
import JoinView from './views/JoinView.vue';
import LoginView from './views/LoginView.vue';
import MeView from './views/MeView.vue';
import RegisterView from './views/RegisterView.vue';

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', name: 'home', component: HomeView },
    { path: '/me', name: 'me', component: MeView },
    { path: '/login', name: 'login', component: LoginView },
    { path: '/register', name: 'register', component: RegisterView },
    { path: '/join/:roomId', name: 'join', component: JoinView },
    { path: '/call/:roomId', name: 'call', component: CallView },
  ],
});
