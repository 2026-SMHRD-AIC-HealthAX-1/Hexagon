package com.smhrd.myapp.controller;

import java.util.List;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;

import com.smhrd.myapp.entity.MemberEntity;
import com.smhrd.myapp.repository.MemberRepository;

import jakarta.servlet.http.HttpSession;

// 이 클래스는 클라이언의 요청을 받는 Controller라고 명시하는 어노테이션
@Controller
public class MemberController {

	// 만들어진 인터페이스 선언 후 주입받아서 사용 -> @Autowired
	@Autowired
	private MemberRepository repo;
	
	// 회원 삭제
	@GetMapping("/deleteMember") // /deleteMember?idx=3
	public String deleteMember(@RequestParam("idx") Long idx, HttpSession session) {
		
		// 로그인을 하지 않았거나 혹은 관리자가 아닌경우 Main.html로 돌아가도록 처리
		MemberEntity mem = (MemberEntity)session.getAttribute("mem");
		if(mem == null || !mem.getEmail().equals("admin")) {
			return "redirect:/";
		}
		
		repo.deleteById(idx);
		
		return "redirect:/showMember";
	}
	
	
	// DB회원정보들 가져오기 + ShowMember.html로 이동
	@GetMapping("/showMember")
	public String showMember(Model model) {
		List<MemberEntity> list = repo.findByEmailNot("admin");
		model.addAttribute("list", list);
		return "ShowMember";
	}
	
	
	// 회원정보수정 기능
	@PostMapping("/memberUpdate")
	public String memberUpdate(MemberEntity mem, HttpSession session) { 
		// idx(PK), email, pw, tel, address
		// PK값이 테이블에 없으면 insert
		// PD값이 테이블에 있으면 update
		repo.save(mem);
		session.setAttribute("mem", mem);
		return "redirect:/";
	}
	
	// 회원정보수정페이지로 이동
	@GetMapping("/updateForm")
	public String updateForm() {
		return "UpdateMember";
	}
	
	// 로그아웃 기능
	@GetMapping("/memberLogout")
	public String memberLogout(HttpSession session) {
//		session.removeAttribute("mem");
		session.invalidate();
		return "redirect:/";
	}
	
	// 로그인 기능
	@PostMapping("/memberLogin")
	public String memberLogin(MemberEntity mem, HttpSession session) { // email, pw
		mem = repo.findByEmailAndPw(mem.getEmail(), mem.getPw());
		// 로그인에 성공했다면 mem(idx, email, pw, tel, address)
		// 로그인에 실패했다면 mem==null
		if(mem != null) {
			session.setAttribute("mem", mem);
		}
		return "redirect:/";
	}
	
	// 회원가입 기능
	// 스프링에서는 input태그의 name값과 객체의 필드값의 이름이 같으면 알아서 묶어줌
	@PostMapping("/memberJoin")
	public String memberJoin(MemberEntity mem, Model model) {
		repo.save(mem); // (email, pw, tel, address)
		model.addAttribute("mem", mem);
		return "JoinSuccess";
	}
	
	// Get방식으로 "/"라고 요청이 들어오면 아래에 있는 main()를 실행하겠다!
	@GetMapping("/")
	public String main() {
		// 이동할 페이지의 경로나 확장자는 뷰리졸버가 붙여주기 때문에 물리적인 뷰 네임만 리턴
		return "Main";
	}
	
}
